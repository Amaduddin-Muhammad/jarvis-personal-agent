import os
import subprocess
import webbrowser
import psutil
import pyautogui
import ctypes
import json

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
            # ctypes implementation
            ctypes.windll.user32.OpenClipboard(None)
            handle = ctypes.windll.user32.GetClipboardData(13) # CF_UNICODETEXT
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
            # ctypes implementation
            ctypes.windll.user32.OpenClipboard(None)
            ctypes.windll.user32.EmptyClipboard()
            hCd = ctypes.windll.kernel32.GlobalAlloc(2, len(text.encode('utf-16-le')) + 2) # GMEM_MOVEABLE
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

# ----------------- TIER 0 TOOLS -----------------

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
            "disk_free_gb": disk.free / (1024**3),
            "disk_total_gb": disk.total / (1024**3)
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ----------------- TIER 1 TOOLS -----------------

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
        return {"status": "success", "message": f"Opened browser redirection to: {url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@register_tool(
    name="screen.capture",
    tier=1,
    description="Takes a screen capture of the main monitor and saves it to disk.",
    schema={
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "Optional name of the destination image file. Defaults to screenshot.png in current scratch."}
        }
    }
)
def screen_capture(filename="screenshot.png"):
    try:
        scratch_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        # Save in scratch/jarvis/src/screenshot.png so it could theoretically be displayed, or in main scratch
        target_path = os.path.join(scratch_dir, filename)
        
        screenshot = pyautogui.screenshot()
        screenshot.save(target_path)
        return {"status": "success", "path": target_path, "message": f"Screen capture preserved at: {target_path}"}
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


# ----------------- TIER 2 TOOLS -----------------

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
        # Ensure directories exist
        os.makedirs(os.path.dirname(resolved_path), exist_ok=True)
        with open(resolved_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"status": "success", "path": resolved_path, "message": f"File successfully written ({len(content)} chars)."}
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
            os.rmdir(resolved_path) # safe deletion (only empty folder)
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
        # Run command synchronously with a timeout
        res = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=15
        )
        return {
            "status": "success",
            "exit_code": res.returncode,
            "stdout": res.stdout,
            "stderr": res.stderr
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Command execution timed out after 15 seconds."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Helper to run a tool from registry
def execute_tool_by_name(name, args_dict):
    if name not in TOOLS_REGISTRY:
        return {"status": "error", "message": f"Tool '{name}' is not registered."}
        
    tool_info = TOOLS_REGISTRY[name]
    func = tool_info["func"]
    
    try:
        # Call function with kwargs unpacked
        return func(**args_dict)
    except Exception as e:
        return {"status": "error", "message": f"Runtime tool crash: {str(e)}"}
