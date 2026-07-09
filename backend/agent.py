import os
import json
import re
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from backend.tools import TOOLS_REGISTRY, execute_tool_by_name

SYSTEM_PROMPT = """You are JARVIS, a highly sophisticated personal AI agent running on the owner's Windows laptop.
You speak directly to the owner in a polite, efficient, and proactive butler-like tone.
You must hold conversations in the owner's language. If they code-switch mid-sentence, you should match their language.

You have access to the local machine and can execute actions. To act, you MUST respond ONLY with a single JSON block of the following structure (no extra text, no markdown wrapper other than standard raw JSON output):

{
  "thought": "Your internal analysis, plan, and next steps.",
  "speak": "Concise, friendly spoken-only response. This is read aloud to the user (no code, no lists, no markdown). Keep it under 20 words.",
  "display": "Detailed markdown text to show on the HUD screen. Use this for tables, code snippets, logs, or lists.",
  "tool_call": null or {
    "name": "fs.list" | "fs.read" | "fs.write" | "fs.delete" | "clipboard.read" | "clipboard.write" | "system.stats" | "app.launch" | "browser.open_url" | "screen.capture" | "shell.run",
    "args": { ... arguments matching the tool schema ... },
    "rationale": "Brief explanation of why you need this action (shown during authorization requests)."
  }
}

Owner's facts and preferences:
{memory_context}

Available Tools:
1. fs.list - args: {"path": "folder_path"} - List directory
2. fs.read - args: {"path": "file_path"} - Read text file content
3. fs.write - args: {"path": "file_path", "content": "file_data"} [TIER 2 - SENSITIVE] - Writes/creates file
4. fs.delete - args: {"path": "file_path"} [TIER 2 - SENSITIVE] - Deletes file
5. clipboard.read - args: {} - Reads clipboard text
6. clipboard.write - args: {"content": "text"} - Overwrites clipboard
7. system.stats - args: {} - Retrieves system CPU/RAM/Battery metrics
8. app.launch - args: {"app_name": "app_or_command"} - Launches a Windows application (e.g. 'notepad')
9. browser.open_url - args: {"url": "http_url"} - Opens default web browser to site
10. screen.capture - args: {"filename": "name.png"} - Takes screenshot
11. shell.run - args: {"command": "powershell_or_cmd"} [TIER 2 - SENSITIVE] - Run terminal command

Rules:
- You must always output valid JSON.
- If you don't need a tool call, set "tool_call": null.
- For Tier 2 operations, the user will be prompted to confirm on their HUD before execution.
- If an operation fails, analyze the error and try a different approach or report it to the owner.
"""

class JarvisOrchestrator:
    def __init__(self, memory_core):
        self.memory = memory_core
        api_key = os.environ.get("NVIDIA_API_KEY", "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")
        
        self.client = ChatNVIDIA(
            model="nvidia/nemotron-3-ultra-550b-a55b",
            api_key=api_key, 
            temperature=0.8,
            top_p=0.95,
            max_tokens=4096,
            reasoning_budget=4096,
            chat_template_kwargs={"enable_thinking": True},
        )
        self.conversation_buffer = []

    def get_system_message(self):
        facts = self.memory.get_all_facts()
        memory_str = "\n".join([f"- {f}" for f in facts]) if facts else "No long-term facts recorded yet."
        prompt = SYSTEM_PROMPT.format(memory_context=memory_str)
        return SystemMessage(content=prompt)

    def parse_json_safely(self, text):
        # Strip markdown code blocks if any
        cleaned = text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            return json.loads(cleaned)
        except Exception:
            # Fallback regex search for JSON block
            match = re.search(r'\{[\s\S]*\}', cleaned)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    pass
            
            # Heavy recovery fallback
            return {
                "thought": "Parser error: response was not valid JSON.",
                "speak": "I encountered an formatting error. Let me repeat my thought process.",
                "display": f"Failed to parse JSON. Raw Output:\n\n{text}",
                "tool_call": None
            }

    def process_query(self, user_text, socket_sender_func):
        # 1. Load history & build prompt
        history = self.memory.get_recent_history(limit=12)
        messages = [self.get_system_message()]
        
        for msg in history:
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

        messages.append(HumanMessage(content=user_text))
        
        # Log incoming
        self.memory.save_message("user", user_text)

        # 2. Invoke NVIDIA LLM
        socket_sender_func({
            "type": "log",
            "level": "SYS",
            "message": "Transmitting query to NVIDIA Nemotron Core..."
        })

        raw_response = ""
        reasoning_content = ""

        try:
            for chunk in self.client.stream(messages):
                # If thinking tokens are present, forward them to the UI as logs
                if chunk.additional_kwargs and "reasoning_content" in chunk.additional_kwargs:
                    rc = chunk.additional_kwargs["reasoning_content"]
                    reasoning_content += rc
                    socket_sender_func({
                        "type": "log",
                        "level": "INFO",
                        "message": f"[Thinking] {rc}"
                    })
                
                raw_response += chunk.content
        except Exception as e:
            error_msg = f"NVIDIA Endpoints Error: {str(e)}"
            socket_sender_func({"type": "log", "level": "ERROR", "message": error_msg})
            return {
                "speak": "Critical connection failure on LangChain client.",
                "display": f"### LangChain NVIDIA Endpoints Error\n\n{str(e)}",
                "tool_call": None
            }

        # 3. Parse Response
        parsed = self.parse_json_safely(raw_response)
        
        # Save response in message history
        # (Store raw JSON response to maintain structured historical context for the model)
        self.memory.save_message("assistant", json.dumps(parsed))

        # Check for facts learning: if thought has something like "Remember: X" or if it decides to save a fact
        # Let's check if the display contains instructions to write memory or if we can auto-extract.
        # For simplicity, we can let the model call a tool or we can write a regex to save facts.
        # Alternatively, if the model mentions "Memory Core:" in display, we can save it.
        # Let's search if the model says "I should remember that ..." in the thought, and save it.
        self.check_and_learn_facts(parsed.get("thought", ""), parsed.get("display", ""))

        return parsed

    def check_and_learn_facts(self, thought, display):
        # Basic heuristic: if the thought contains "remember that" or "save fact"
        # we can learn something. Also we can parse specific patterns like:
        # [Memory: User prefers VS Code]
        matches = re.findall(r'\[Memory:\s*(.*?)\]', thought + "\n" + display)
        for m in matches:
            self.memory.save_fact(m.strip())
        
        # Let's also look for sentences like "I will record in my memory core: X"
        m2 = re.findall(r'(?:record|save|remember) in memory core(?:\s*that)?:\s*([^\.\n]+)', thought + "\n" + display, re.IGNORECASE)
        for m in m2:
            self.memory.save_fact(m.strip())
