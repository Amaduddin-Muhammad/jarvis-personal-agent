import os
import json
import re
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from tools import TOOLS_REGISTRY, execute_tool_by_name

SYSTEM_PROMPT = """You are JARVIS, a world-class personal AI agent running on the owner's Windows laptop. You are highly sophisticated, proactive, and operate like the best AI assistant ever built — a true best friend who anticipates needs, solves complex problems, and acts with precision.

You speak in a polished, warm, efficient butler-like tone. Match the owner's language if they code-switch.

## HOW TO RESPOND

You MUST always output a single valid JSON object with exactly this structure:

{
  "thought": "Your internal multi-step analysis. Break down the task, plan your approach, and reason step by step.",
  "speak": "Concise spoken response for TTS. Max 25 words. No markdown, no code, no lists.",
  "display": "Detailed markdown to show on the HUD screen. Use headers, tables, code blocks, and bullet lists freely.",
  "tool_call": null | {
    "name": "<tool_name>",
    "args": { ...tool arguments... },
    "rationale": "One sentence explaining why this tool call is needed."
  }
}

## AGENTIC RULES

1. **Think before acting**: Always reason thoroughly in "thought" before calling a tool.
2. **Chain actions**: After a tool result is fed back to you, continue reasoning. Call another tool if needed. Repeat until the task is fully complete.
3. **Be proactive**: If you notice something useful (like low battery in stats, or an error), mention it unprompted.
4. **Learn automatically**: Extract and remember preferences from conversation. Use [Memory: fact] tags in your thought to trigger memory saving.
5. **Handle failures gracefully**: If a tool fails, try an alternative approach. Never give up without at least 2 attempts.
6. **Never hallucinate tool results**: Only report what tools actually return.
7. **Speak naturally**: The "speak" field is read aloud. Keep it conversational and warm.

## AVAILABLE TOOLS

### Tier 0 — Auto-Approved (no confirmation needed)
- `fs.list` — {"path": "folder_path"} — List directory contents
- `fs.read` — {"path": "file_path"} — Read text file
- `clipboard.read` — {} — Read clipboard text
- `system.stats` — {} — Get CPU, RAM, battery, disk metrics
- `datetime.now` — {} — Get current date, time, day of week
- `web.search` — {"query": "search terms", "max_results": 5} — Real-time DuckDuckGo web search
- `web.fetch_page` — {"url": "https://...", "max_chars": 3000} — Fetch and read a web page as plain text
- `notes.list` — {} — List all saved notes
- `notes.read` — {"title": "note title"} — Read a specific note

### Tier 1 — Auto-Approved (sensitive but trusted)
- `app.launch` — {"app_name": "notepad"} — Launch a desktop application
- `browser.open_url` — {"url": "https://..."} — Open URL in browser
- `screen.capture` — {"filename": "shot.png"} — Take a screenshot
- `clipboard.write` — {"content": "text"} — Write to clipboard
- `notes.write` — {"title": "note title", "content": "full text"} — Save or update a note
- `reminder.set` — {"text": "reminder message", "seconds": 1800} — Set a timed reminder (seconds from now)
- `volume.set` — {"level": 50} — Set system volume 0-100
- `window.control` — {"action": "minimize"|"maximize"|"restore"} — Control active window
- `image.generate` — {"prompt": "...", "style_preset": "photorealistic|cinematic|anime|oil_painting|watercolor|3d_render|pixel_art|sketch", "width": 1024, "height": 1024, "negative_prompt": "...", "filename": "name.png", "seed": 0} — Generate AI image from text prompt using NVIDIA SDXL
- `document.create_word` — {"title": "...", "sections": [...], "subtitle": "...", "author": "...", "filename": "report.docx"} — Create rich Word .docx document with title page, TOC, sections, images, tables, code blocks
- `document.open_file` — {"path": "/abs/path/to/file"} — Open a file with default application (Word, image viewer, etc.)

### Tier 2 — Requires Owner Confirmation
- `fs.write` — {"path": "file_path", "content": "text"} — Write/create a file [SENSITIVE]
- `fs.delete` — {"path": "file_path"} — Delete a file [SENSITIVE]
- `shell.run` — {"command": "cmd string"} — Run a shell command [SENSITIVE]
- `process.kill` — {"process_name": "app.exe"} — Kill a running process [SENSITIVE]

## MEMORY & LEARNING

Owner's known facts and preferences:
{memory_context}

When you learn something new about the owner (name, preferences, habits, work), include [Memory: <fact>] in your thought field. This will be automatically extracted and saved to your long-term memory.

## EXAMPLES

**User**: "What time is it?"
**You**: call `datetime.now`, then speak "It's 3:47 PM on Wednesday."

**User**: "Search for the latest iPhone news"
**You**: call `web.search` with query "latest iPhone news 2025", then summarize top 3 results in display, speak a 1-sentence summary.

**User**: "Remind me to take my medicine in 20 minutes"
**You**: call `reminder.set` with text="Take your medicine!" seconds=1200, speak "Done! I'll remind you in 20 minutes."

**User**: "Open Spotify and set volume to 60"
**You**: call `app.launch` with app_name="spotify", THEN in the next step call `volume.set` with level=60.
"""


class JarvisOrchestrator:
    def __init__(self, memory_core):
        self.memory = memory_core
        api_key = os.environ.get("NVIDIA_API_KEY", "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")

        self.client = ChatNVIDIA(
            model="nvidia/nemotron-3-ultra-550b-a55b",
            api_key=api_key,
            temperature=0.7,
            top_p=0.9,
            max_completion_tokens=2048,
            chat_template_kwargs={"enable_thinking": False},
        )
        self.conversation_buffer = []

    def get_system_message(self):
        facts = self.memory.get_all_facts()
        memory_str = "\n".join([f"- {f}" for f in facts]) if facts else "No long-term facts recorded yet."
        prompt = SYSTEM_PROMPT.replace("{memory_context}", memory_str)
        return SystemMessage(content=prompt)

    def parse_json_safely(self, text):
        cleaned = text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        # Step 1: Try direct parse with strict=False (allows unescaped control chars like newlines)
        try:
            return json.loads(cleaned, strict=False)
        except Exception:
            pass

        # Step 2: Try brace balancing to extract a clean JSON object block
        start_idx = cleaned.find('{')
        if start_idx != -1:
            balance = 0
            in_string = False
            escape = False
            for idx in range(start_idx, len(cleaned)):
                char = cleaned[idx]
                if escape:
                    escape = False
                    continue
                if char == '\\':
                    escape = True
                    continue
                if char == '"':
                    in_string = not in_string
                    continue
                if not in_string:
                    if char == '{':
                        balance += 1
                    elif char == '}':
                        balance -= 1
                        if balance == 0:
                            candidate = cleaned[start_idx:idx+1]
                            try:
                                return json.loads(candidate, strict=False)
                            except Exception:
                                pass

        # Step 3: Regular Expression fallback
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if match:
            try:
                return json.loads(match.group(0), strict=False)
            except Exception:
                pass

        return {
            "thought": "Parser error: response was not valid JSON.",
            "speak": "I had a formatting error. Please try again.",
            "display": f"Failed to parse JSON. Raw Output:\n\n```\n{text}\n```",
            "tool_call": None
        }


    def process_query(self, user_text, socket_sender_func):
        """
        Full ReAct agentic loop. Continues calling tools until the task is done
        or max_steps is reached.
        """
        print(f"AGENT START: process_query for: {user_text}", flush=True)

        # Build initial message history
        history = self.memory.get_recent_history(limit=20)
        sys_msg = self.get_system_message()
        messages = [sys_msg]

        for msg in history:
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

        messages.append(HumanMessage(content=user_text))
        self.memory.save_message("user", user_text)

        socket_sender_func({
            "type": "agent_state",
            "state": "THINKING"
        })

        max_steps = 8
        final_response = None

        for step in range(max_steps):
            print(f"AGENT LOOP step {step + 1}/{max_steps}", flush=True)

            # ── Invoke LLM ──
            socket_sender_func({
                "type": "log",
                "level": "SYS",
                "message": f"[Step {step + 1}] Reasoning..."
            })

            raw_response = ""
            try:
                for chunk in self.client.stream(messages):
                    raw_response += chunk.content
            except Exception as e:
                error_msg = f"LLM Error at step {step + 1}: {str(e)}"
                socket_sender_func({"type": "log", "level": "ERROR", "message": error_msg})
                return {
                    "speak": "I lost my connection to the AI core. Please try again.",
                    "display": f"### Connection Error\n\n```\n{str(e)}\n```",
                    "tool_call": None
                }

            parsed = self.parse_json_safely(raw_response)
            print(f"AGENT step {step + 1} parsed: {json.dumps(parsed)[:300]}", flush=True)

            # ── Emit thought chain step to HUD ──
            thought = parsed.get("thought", "")
            if thought:
                socket_sender_func({
                    "type": "step",
                    "step_num": step + 1,
                    "kind": "think",
                    "content": thought
                })

            # ── Auto-extract facts from thought ──
            self.check_and_learn_facts(thought, parsed.get("display", ""))

            # ── Check for tool call ──
            tool_call = parsed.get("tool_call")

            if not tool_call:
                # No more actions needed — this is the final response
                final_response = parsed
                break

            tool_name = tool_call.get("name", "")
            tool_args = tool_call.get("args", {})
            tool_rationale = tool_call.get("rationale") or parsed.get("rationale") or ""


            # ── Emit ACT step to HUD ──
            socket_sender_func({
                "type": "step",
                "step_num": step + 1,
                "kind": "act",
                "content": f"**Tool**: `{tool_name}`\n**Args**: `{json.dumps(tool_args)}`\n**Reason**: {tool_rationale}"
            })

            tool_info = TOOLS_REGISTRY.get(tool_name)
            if not tool_info:
                tool_result = {"status": "error", "message": f"Unknown tool: {tool_name}"}
            else:
                tier = tool_info.get("tier", 0)
                if tier >= 2:
                    # Return this step for confirmation — server.py handles the confirm flow
                    # Signal that we need confirmation by returning with tool_call intact
                    socket_sender_func({
                        "type": "agent_state",
                        "state": "IDLE"
                    })
                    return parsed
                else:
                    socket_sender_func({
                        "type": "log",
                        "level": "OK",
                        "message": f"Executing tool: {tool_name}"
                    })
                    socket_sender_func({
                        "type": "agent_state",
                        "state": "ACTING"
                    })
                    tool_result = execute_tool_by_name(tool_name, tool_args)
                    self.memory.log_action(tool_name, tool_args, tier, True, str(tool_result.get("status")))

            print(f"AGENT tool result: {str(tool_result)[:300]}", flush=True)

            # ── Emit OBSERVE step to HUD ──
            socket_sender_func({
                "type": "step",
                "step_num": step + 1,
                "kind": "observe",
                "content": f"```json\n{json.dumps(tool_result, indent=2)[:1500]}\n```"
            })

            # ── Feed result back into message chain ──
            # Add the assistant's last reasoning as an AI message
            messages.append(AIMessage(content=raw_response))
            # Add the tool result as a human (observation) message
            observation = f"Tool `{tool_name}` result:\n{json.dumps(tool_result)}"
            messages.append(HumanMessage(content=observation))

            socket_sender_func({
                "type": "agent_state",
                "state": "THINKING"
            })

        if final_response is None:
            # Ran out of steps
            final_response = {
                "thought": "Reached max steps without completing task.",
                "speak": "I reached my step limit. Let me summarize what I found.",
                "display": "### Max Steps Reached\n\nI completed all available reasoning steps. Here is the last known result.",
                "tool_call": None
            }

        # Save final assistant response
        self.memory.save_message("assistant", json.dumps(final_response))

        socket_sender_func({
            "type": "agent_state",
            "state": "SPEAKING"
        })

        return final_response

    def check_and_learn_facts(self, thought, display):
        # Pattern: [Memory: some fact]
        matches = re.findall(r'\[Memory:\s*(.*?)\]', thought + "\n" + display)
        for m in matches:
            self.memory.save_fact(m.strip())

        # Pattern: "record/save/remember in memory core: X"
        m2 = re.findall(
            r'(?:record|save|remember) in memory core(?:\s*that)?:\s*([^\.\n]+)',
            thought + "\n" + display,
            re.IGNORECASE
        )
        for m in m2:
            self.memory.save_fact(m.strip())
