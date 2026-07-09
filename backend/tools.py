import os
import subprocess
import webbrowser
import psutil
import pyautogui
import ctypes
import json
import datetime
import urllib.request
import urllib.parse
import html
import re


# Fallback for clipboard because pywin32 might not be fully configured or needs compilation.
# We can use Tkinter or ctypes to read/write clipboard to ensure 100% success without dependencies.
def get_clipboard_text():
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        text = root.clipboard_get()
        return text
    except Exception:
        try:
            ctypes.windll.user32.OpenClipboard(None)
            handle = ctypes.windll.user32.GetClipboardData(13)  # CF_UNICODETEXT
            if handle:
                ptr = ctypes.windll.kernel32.GlobalLock(handle)
                text = ctypes.c_wchar_p(ptr).value
                ctypes.windll.kernel32.GlobalUnlock(handle)
            else:
                text = ""
            ctypes.windll.user32.CloseClipboard()
            return text
        except Exception as e:
            return f"Error reading clipboard: {str(e)}"


def set_clipboard_text(text):
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
        return "Text copied to clipboard successfully."
    except Exception:
        try:
            ctypes.windll.user32.OpenClipboard(None)
            ctypes.windll.user32.EmptyClipboard()
            hCd = ctypes.windll.kernel32.GlobalAlloc(2, len(text.encode('utf-16-le')) + 2)
            pchData = ctypes.windll.kernel32.GlobalLock(hCd)
            ctypes.cdll.msvcrt.wcscpy(ctypes.c_wchar_p(pchData), text)
            ctypes.windll.kernel32.GlobalUnlock(hCd)
            ctypes.windll.user32.SetClipboardData(13, hCd)
            ctypes.windll.user32.CloseClipboard()
            return "Text copied to clipboard successfully."
        except Exception as e:
            return f"Error writing to clipboard: {str(e)}"


# ==========================================
# TOOL DEFINITIONS & REGISTRY
# ==========================================

# Dict of registered tools: name -> tool_info
TOOLS_REGISTRY = {}

# Notes and reminders singletons (injected by server.py at startup)
_notes_core = None
_reminders_core = None


def inject_cores(notes_core, reminders_core):
    global _notes_core, _reminders_core
    _notes_core = notes_core
    _reminders_core = reminders_core


def register_tool(name, tier, description, schema):
    def decorator(func):
        TOOLS_REGISTRY[name] = {
            "name": name,
            "tier": tier,
            "description": description,
            "schema": schema,
            "func": func
        }
        return func
    return decorator


# ==========================================
# TIER 0 TOOLS  (fully auto-approved)
# ==========================================

@register_tool(
    name="fs.list",
    tier=0,
    description="Lists the contents of a directory. Returns file names and folders.",
    schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to listing directory. Defaults to current directory."}
        }
    }
)
def fs_list(path="."):
    try:
        resolved_path = os.path.abspath(path)
        items = os.listdir(resolved_path)
        result = []
        for item in items:
            item_path = os.path.join(resolved_path, item)
            is_dir = os.path.isdir(item_path)
            size = os.path.getsize(item_path) if not is_dir else 0
            result.append({
                "name": item,
                "type": "directory" if is_dir else "file",
                "size_bytes": size
            })
        return {"status": "success", "path": resolved_path, "items": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="fs.read",
    tier=0,
    description="Reads the contents of a text file.",
    schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to target file."}
        },
        "required": ["path"]
    }
)
def fs_read(path):
    try:
        resolved_path = os.path.abspath(path)
        if not os.path.exists(resolved_path):
            return {"status": "error", "message": "File does not exist."}
        if os.path.isdir(resolved_path):
            return {"status": "error", "message": "Path is a directory, not a file."}
        with open(resolved_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return {"status": "success", "path": resolved_path, "content": content}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="clipboard.read",
    tier=0,
    description="Retrieves the current text stored in the system clipboard.",
    schema={"type": "object", "properties": {}}
)
def clipboard_read():
    text = get_clipboard_text()
    return {"status": "success", "content": text}


@register_tool(
    name="system.stats",
    tier=0,
    description="Retrieves current system statistics including CPU, memory, battery, and disk storage.",
    schema={"type": "object", "properties": {}}
)
def system_stats():
    try:
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent
        battery = psutil.sensors_battery()
        bat_percent = battery.percent if battery else 100
        disk = psutil.disk_usage('/')
        return {
            "status": "success",
            "cpu_percent": cpu,
            "memory_percent": mem,
            "battery_percent": bat_percent,
            "disk_free_gb": disk.free / (1024 ** 3),
            "disk_total_gb": disk.total / (1024 ** 3)
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="datetime.now",
    tier=0,
    description="Returns the current local date, time, day of week, and timezone offset.",
    schema={"type": "object", "properties": {}}
)
def datetime_now():
    now = datetime.datetime.now()
    tz = datetime.datetime.now(datetime.timezone.utc).astimezone()
    return {
        "status": "success",
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "day_of_week": now.strftime("%A"),
        "datetime_iso": now.isoformat(),
        "timezone": str(tz.tzinfo)
    }


@register_tool(
    name="web.search",
    tier=0,
    description="Performs a real-time web search using DuckDuckGo and returns the top results with titles, URLs, and snippets.",
    schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search query string."},
            "max_results": {"type": "integer", "description": "Max number of results to return (default 5)."}
        },
        "required": ["query"]
    }
)
def web_search(query, max_results=5):
    try:
        encoded = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="ignore")

        # Parse result links and snippets from DDG HTML
        results = []
        # Match result divs
        pattern = re.compile(
            r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
            r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            re.DOTALL
        )
        for m in pattern.finditer(body):
            if len(results) >= max_results:
                break
            href = html.unescape(m.group(1))
            title = re.sub(r'<[^>]+>', '', m.group(2)).strip()
            snippet = re.sub(r'<[^>]+>', '', m.group(3)).strip()
            title = html.unescape(title)
            snippet = html.unescape(snippet)
            if href.startswith("http"):
                results.append({"title": title, "url": href, "snippet": snippet})

        if not results:
            return {"status": "success", "query": query, "results": [], "note": "No results parsed. Try a different query."}

        return {"status": "success", "query": query, "results": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="web.fetch_page",
    tier=0,
    description="Fetches the plain text content of a web page URL (strips HTML tags). Useful for reading articles.",
    schema={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "Full URL to fetch (must start with http:// or https://)."},
            "max_chars": {"type": "integer", "description": "Maximum characters to return (default 3000)."}
        },
        "required": ["url"]
    }
)
def web_fetch_page(url, max_chars=3000):
    try:
        if not url.startswith("http"):
            url = "https://" + url
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
        # Strip scripts and styles first
        body = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '', body, flags=re.DOTALL | re.IGNORECASE)
        # Strip all tags
        text = re.sub(r'<[^>]+>', ' ', body)
        # Collapse whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        text = html.unescape(text)
        return {"status": "success", "url": url, "content": text[:max_chars], "truncated": len(text) > max_chars}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="notes.list",
    tier=0,
    description="Lists all saved JARVIS notes with their titles and last updated timestamps.",
    schema={"type": "object", "properties": {}}
)
def notes_list():
    if _notes_core is None:
        return {"status": "error", "message": "Notes core not initialized."}
    return _notes_core.list_notes()


@register_tool(
    name="notes.read",
    tier=0,
    description="Reads the content of a specific saved note by its title.",
    schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Exact title of the note to read."}
        },
        "required": ["title"]
    }
)
def notes_read(title):
    if _notes_core is None:
        return {"status": "error", "message": "Notes core not initialized."}
    return _notes_core.read_note(title)


# ==========================================
# TIER 1 TOOLS  (auto-approved, sensitive UI)
# ==========================================

@register_tool(
    name="app.launch",
    tier=1,
    description="Launches a local desktop application or command-line utility.",
    schema={
        "type": "object",
        "properties": {
            "app_name": {"type": "string", "description": "The name or path of the app to launch (e.g., 'notepad', 'chrome', 'calc')."}
        },
        "required": ["app_name"]
    }
)
def app_launch(app_name):
    try:
        app_lower = app_name.lower().strip()
        common_paths = {
            "chrome": [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            ],
            "edge": [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
            ],
            "vscode": [
                os.path.expandvars(r"%USERPROFILE%\AppData\Local\Programs\Microsoft VS Code\Code.exe")
            ],
            "code": [
                os.path.expandvars(r"%USERPROFILE%\AppData\Local\Programs\Microsoft VS Code\Code.exe")
            ],
            "spotify": [
                os.path.expandvars(r"%APPDATA%\Spotify\Spotify.exe"),
                os.path.expandvars(r"%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\Spotify.exe")
            ],
            "discord": [
                os.path.expandvars(r"%USERPROFILE%\AppData\Local\Discord\Update.exe")
            ]
        }

        target_path = None
        if app_lower in common_paths:
            for path in common_paths[app_lower]:
                if os.path.exists(path):
                    target_path = path
                    break

        if app_lower == "discord" and target_path:
            cmd = f'"{target_path}" --processStart Discord.exe'
        elif target_path:
            cmd = f'"{target_path}"'
        else:
            cmd = f'start "" "{app_name}"'

        subprocess.Popen(cmd, shell=True)
        return {"status": "success", "message": f"Successfully launched: {app_name}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="browser.open_url",
    tier=1,
    description="Opens a URL in the owner's default web browser.",
    schema={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The web URL to load (e.g., 'https://google.com')."}
        },
        "required": ["url"]
    }
)
def browser_open_url(url):
    try:
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url
        webbrowser.open(url)
        return {"status": "success", "message": f"Opened browser to: {url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="screen.capture",
    tier=1,
    description="Takes a screen capture of the main monitor and saves it to disk.",
    schema={
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "Optional name of the destination image file. Defaults to screenshot.png."}
        }
    }
)
def screen_capture(filename="screenshot.png"):
    try:
        scratch_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        target_path = os.path.join(scratch_dir, filename)
        screenshot = pyautogui.screenshot()
        screenshot.save(target_path)
        return {"status": "success", "path": target_path, "message": f"Screen capture saved at: {target_path}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="clipboard.write",
    tier=1,
    description="Overwrites the system clipboard with the provided text.",
    schema={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "The text to copy to clipboard."}
        },
        "required": ["content"]
    }
)
def clipboard_write(content):
    res = set_clipboard_text(content)
    return {"status": "success", "message": res}


@register_tool(
    name="notes.write",
    tier=1,
    description="Creates or updates a named note in the JARVIS knowledge base. Use this to remember information the owner asks you to save.",
    schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short descriptive title for the note."},
            "content": {"type": "string", "description": "Full text content to store in the note."}
        },
        "required": ["title", "content"]
    }
)
def notes_write(title, content):
    if _notes_core is None:
        return {"status": "error", "message": "Notes core not initialized."}
    return _notes_core.write_note(title, content)


@register_tool(
    name="reminder.set",
    tier=1,
    description="Schedules a voice reminder to fire after a specified number of seconds from now.",
    schema={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The reminder message to speak when the timer fires."},
            "seconds": {"type": "integer", "description": "How many seconds from now to fire the reminder. E.g. 1800 for 30 minutes."}
        },
        "required": ["text", "seconds"]
    }
)
def reminder_set(text, seconds):
    if _reminders_core is None:
        return {"status": "error", "message": "Reminders core not initialized."}
    return _reminders_core.set_reminder(text, seconds)


@register_tool(
    name="volume.set",
    tier=1,
    description="Sets the system master audio volume level.",
    schema={
        "type": "object",
        "properties": {
            "level": {"type": "integer", "description": "Volume level from 0 (mute) to 100 (max)."}
        },
        "required": ["level"]
    }
)
def volume_set(level):
    try:
        level = max(0, min(100, int(level)))
        # Use PowerShell to set system volume via Windows Audio
        ps_cmd = f"""
$obj = New-Object -ComObject WScript.Shell;
$vol = [int](({level} / 100) * 65535);
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class AudioApi {{
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}}
'@;
for ($i = 0; $i -le 50; $i++) {{ [AudioApi]::SendMessage(-1, 0x319, 0, 0xA0000); }};
$vol_steps = [Math]::Round($vol / 655.35);
"""
        # Simpler and more reliable approach via nircmd if available, else PowerShell audio API
        result = subprocess.run(
            ["powershell", "-Command",
             f"(New-Object -ComObject WScript.Shell).SendKeys([char]174 * 50); "
             f"$steps = [Math]::Round({level} / 2); "
             f"(New-Object -ComObject WScript.Shell).SendKeys([char]175 * $steps)"],
            capture_output=True, text=True, timeout=5
        )
        return {"status": "success", "level": level, "message": f"Volume set to approximately {level}%."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="window.control",
    tier=1,
    description="Controls the currently active window — minimize, maximize, or restore it.",
    schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "description": "Action to perform: 'minimize', 'maximize', or 'restore'."}
        },
        "required": ["action"]
    }
)
def window_control(action):
    try:
        action = action.lower().strip()
        cmd_map = {
            "minimize": "(New-Object -ComObject WScript.Shell).SendKeys('%{ }n')",
            "maximize": "(New-Object -ComObject WScript.Shell).SendKeys('%{ }x')",
            "restore": "(New-Object -ComObject WScript.Shell).SendKeys('%{ }r')"
        }
        if action not in cmd_map:
            return {"status": "error", "message": f"Unknown action '{action}'. Use: minimize, maximize, restore."}
        subprocess.run(["powershell", "-Command", cmd_map[action]], capture_output=True, timeout=5)
        return {"status": "success", "message": f"Window {action}d."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ==========================================
# TIER 2 TOOLS  (requires explicit user approval)
# ==========================================

@register_tool(
    name="fs.write",
    tier=2,
    description="Creates or overwrites a file with specific text content.",
    schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to the destination file."},
            "content": {"type": "string", "description": "The text to write inside the file."}
        },
        "required": ["path", "content"]
    }
)
def fs_write(path, content):
    try:
        resolved_path = os.path.abspath(path)
        os.makedirs(os.path.dirname(resolved_path), exist_ok=True)
        with open(resolved_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"status": "success", "path": resolved_path, "message": f"File written ({len(content)} chars)."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="fs.delete",
    tier=2,
    description="Deletes/removes a file from the file system.",
    schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to file to remove."}
        },
        "required": ["path"]
    }
)
def fs_delete(path):
    try:
        resolved_path = os.path.abspath(path)
        if not os.path.exists(resolved_path):
            return {"status": "error", "message": "Target file does not exist."}
        if os.path.isdir(resolved_path):
            os.rmdir(resolved_path)
        else:
            os.remove(resolved_path)
        return {"status": "success", "path": resolved_path, "message": "Resource deleted successfully."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="shell.run",
    tier=2,
    description="Runs an arbitrary shell command in the Windows terminal. Returns stdout and stderr.",
    schema={
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The shell/command line string to execute."}
        },
        "required": ["command"]
    }
)
def shell_run(command):
    try:
        res = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        return {
            "status": "success",
            "exit_code": res.returncode,
            "stdout": res.stdout[:3000],
            "stderr": res.stderr[:1000]
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Command timed out after 30 seconds."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@register_tool(
    name="process.kill",
    tier=2,
    description="Terminates a running process by its name (e.g., 'chrome.exe', 'notepad.exe').",
    schema={
        "type": "object",
        "properties": {
            "process_name": {"type": "string", "description": "Name of the process executable to kill (e.g., 'notepad.exe')."}
        },
        "required": ["process_name"]
    }
)
def process_kill(process_name):
    try:
        killed = 0
        for proc in psutil.process_iter(['pid', 'name']):
            if proc.info['name'] and proc.info['name'].lower() == process_name.lower():
                proc.kill()
                killed += 1
        if killed:
            return {"status": "success", "message": f"Terminated {killed} instance(s) of '{process_name}'."}
        return {"status": "error", "message": f"No process named '{process_name}' found."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# Helper to run a tool from registry
def execute_tool_by_name(name, args_dict):
    if name not in TOOLS_REGISTRY:
        return {"status": "error", "message": f"Tool '{name}' is not registered."}
    tool_info = TOOLS_REGISTRY[name]
    func = tool_info["func"]
    try:
        return func(**args_dict)
    except Exception as e:
        return {"status": "error", "message": f"Runtime tool crash: {str(e)}"}
