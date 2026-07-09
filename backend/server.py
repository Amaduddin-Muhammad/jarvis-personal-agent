import os
import asyncio
import json
import uuid
import time
import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from backend.memory import MemoryCore
from backend.agent import JarvisOrchestrator
from backend.tools import TOOLS_REGISTRY, execute_tool_by_name

app = FastAPI(title="JARVIS Server Core")

# Enable CORS for local GUI connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared Core States
memory = MemoryCore()
orchestrator = JarvisOrchestrator(memory)

# Track active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# Cache pending Tier 2/3 confirmations
# format: confirm_id -> {"tool": str, "args": dict, "rationale": str, "depth": int}
pending_confirmations = {}

# Keep track of previous network counters for speed calculations
prev_net_io = psutil.net_io_counters()
prev_time = time.time()

# ==========================================
# BACKGROUND SYSTEM MONITOR THREAD
# ==========================================
async def monitor_vitals_loop():
    global prev_net_io, prev_time
    while True:
        try:
            # CPU and RAM
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory().percent
            
            # Battery
            battery = psutil.sensors_battery()
            bat_percent = battery.percent if battery else 100
            
            # Network speeds (MB/s Up, KB/s Down)
            now = time.time()
            curr_net_io = psutil.net_io_counters()
            elapsed = now - prev_time if now - prev_time > 0 else 1.0
            
            bytes_sent = curr_net_io.bytes_sent - prev_net_io.bytes_sent
            bytes_recv = curr_net_io.bytes_recv - prev_net_io.bytes_recv
            
            net_up_mb = (bytes_sent / elapsed) / (1024 * 1024)
            net_down_kb = (bytes_recv / elapsed) / 1024
            
            prev_net_io = curr_net_io
            prev_time = now

            # Top Processes
            processes = []
            for proc in psutil.process_iter(['name', 'cpu_percent', 'memory_percent']):
                try:
                    pinfo = proc.info
                    name = pinfo['name']
                    # Skip idle processes if name matches
                    if name in ['Idle', 'System Idle Process']:
                        continue
                    
                    cpu_p = pinfo['cpu_percent'] or 0.0
                    mem_p = pinfo['memory_percent'] or 0.0
                    
                    processes.append({
                        "name": name,
                        "cpu": cpu_p,
                        "memory": mem_p
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    pass
            
            # Sort by CPU and get top 8
            processes.sort(key=lambda x: x['cpu'], reverse=True)
            
            vitals_data = {
                "type": "vitals",
                "data": {
                    "cpu": int(cpu),
                    "ram": int(mem),
                    "battery": int(bat_percent),
                    "network": {
                        "sent_mb": net_up_mb,
                        "recv_kb": net_down_kb
                    },
                    "processes": processes[:8]
                }
            }
            await manager.broadcast(vitals_data)
        except Exception as e:
            print(f"Error in vitals monitor: {e}")
            
        await asyncio.sleep(2.0)

# ==========================================
# RECURSIVE AGENT LOOP EXECUTOR
# ==========================================
async def execute_agent_loop(websocket: WebSocket, user_text: str, depth: int = 0):
    if depth > 3:
        await send_log(websocket, "WARN", "Agent recursion depth limit exceeded (3). Halting execution loop.")
        return

    loop = asyncio.get_running_loop()

    # Helper function to send logs directly from agent to socket
    def socket_logger(msg_dict):
        # Schedule the coroutine to run on the main thread's event loop
        asyncio.run_coroutine_threadsafe(websocket.send_json(msg_dict), loop)

    # Process query in executor thread
    parsed = await loop.run_in_executor(None, orchestrator.process_query, user_text, socket_logger)
    
    # Send display & speak output to client
    await websocket.send_json({
        "type": "agent_response",
        "content": parsed.get("display", ""),
        "speak_text": parsed.get("speak", "")
    })

    # Check for tool call
    tool_call = parsed.get("tool_call")
    if not tool_call:
        # Loop complete! Update memory core facts
        facts = memory.get_all_facts()
        await websocket.send_json({
            "type": "memory",
            "facts": facts
        })
        return

    tool_name = tool_call.get("name")
    tool_args = tool_call.get("args", {})
    rationale = tool_call.get("rationale", "No rationale specified.")

    # Retrieve tool metadata
    if tool_name not in TOOLS_REGISTRY:
        await send_log(websocket, "ERROR", f"Tool '{tool_name}' is not registered.")
        # Feed error back to model
        await execute_agent_loop(
            websocket, 
            f"Action result for '{tool_name}': Tool not found in registry.", 
            depth + 1
        )
        return

    tool_info = TOOLS_REGISTRY[tool_name]
    tier = tool_info["tier"]

    # Handshake permission tiers
    if tier <= 1:
        # Auto-approved! Execute immediately
        await execute_approved_tool(websocket, tool_name, tool_args, tier, depth)
    else:
        # Tier 2/3 - requires explicit confirmation
        confirm_id = str(uuid.uuid4())
        pending_confirmations[confirm_id] = {
            "tool": tool_name,
            "args": tool_args,
            "rationale": rationale,
            "depth": depth
        }
        
        await websocket.send_json({
            "type": "require_confirmation",
            "id": confirm_id,
            "tool": tool_name,
            "scope": json.dumps(tool_args),
            "rationale": rationale
        })
        await send_log(websocket, "WARN", f"Privileged action [{tool_name}] (Tier {tier}) intercepted. Awaiting authorization.")

async def execute_approved_tool(websocket: WebSocket, tool_name: str, tool_args: dict, tier: int, depth: int):
    await send_log(websocket, "SYS", f"Executing [{tool_name}] (Tier {tier}) args: {json.dumps(tool_args)}")
    
    # Run the tool
    try:
        # Run synchronously in executor to avoid blocking the async event loop
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, execute_tool_by_name, tool_name, tool_args)
        
        # Log to audit database
        status_outcome = "success" if result.get("status") == "success" else "error"
        memory.log_action(tool_name, tool_args, tier, authorized=True, outcome=status_outcome)
        
        if status_outcome == "success":
            await send_log(websocket, "OK", f"Action [{tool_name}] completed successfully.")
        else:
            await send_log(websocket, "ERROR", f"Action [{tool_name}] failed: {result.get('message')}")
            
    except Exception as e:
        result = {"status": "error", "message": str(e)}
        memory.log_action(tool_name, tool_args, tier, authorized=True, outcome=f"crash: {str(e)}")
        await send_log(websocket, "ERROR", f"Action [{tool_name}] crashed: {str(e)}")

    # Feed result back into the agent loop
    feedback_text = f"Action result for '{tool_name}': {json.dumps(result)}"
    await execute_agent_loop(websocket, feedback_text, depth + 1)

async def send_log(websocket: WebSocket, level: str, message: str):
    await websocket.send_json({
        "type": "log",
        "level": level,
        "message": message
    })

# ==========================================
# WEBSOCKET ENTRY POINT
# ==========================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Push initial history and memory core facts
    facts = memory.get_all_facts()
    await websocket.send_json({
        "type": "memory",
        "facts": facts
    })
    
    await send_log(websocket, "OK", "Security handshake complete. Welcome back, Owner.")
    
    try:
        while True:
            data = await websocket.receive_text()
            print(f"WS RECEIVED: {data}", flush=True)
            payload = json.loads(data)
            p_type = payload.get("type")
            
            if p_type == "user_message":
                content = payload.get("content", "")
                await execute_agent_loop(websocket, content, depth=0)
                
            elif p_type == "system_command":
                command = payload.get("command")
                if command == "wakeup":
                    print("SYSTEM COMMAND: wakeup received. Activating window.", flush=True)
                    import subprocess
                    ps_cmd = (
                        "$wshell = New-Object -ComObject wscript.shell; "
                        "if ($wshell.AppActivate('JARVIS HUD Console')) { "
                        "  Write-Host 'Window activated.' "
                        "} else { "
                        "  Write-Host 'Failed to find window.' "
                        "}"
                    )
                    subprocess.Popen(["powershell", "-Command", ps_cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
            elif p_type == "confirm_response":
                confirm_id = payload.get("confirm_id")
                approved = payload.get("approved", False)
                
                if confirm_id in pending_confirmations:
                    record = pending_confirmations.pop(confirm_id)
                    tool_name = record["tool"]
                    tool_args = record["args"]
                    depth = record["depth"]
                    
                    if approved:
                        await send_log(websocket, "OK", f"Privileged action [{tool_name}] approved by owner.")
                        await execute_approved_tool(websocket, tool_name, tool_args, tier=2, depth=depth)
                    else:
                        await send_log(websocket, "WARN", f"Privileged action [{tool_name}] aborted: Owner denied permission.")
                        # Log authorization denial in DB
                        memory.log_action(tool_name, tool_args, permission_tier=2, authorized=False, outcome="denied")
                        # Feed cancellation feedback to the agent
                        feedback_text = f"Action result for '{tool_name}': Aborted. The owner clicked 'Cancel' and explicitly denied permission to run this action."
                        await execute_agent_loop(websocket, feedback_text, depth + 1)
                else:
                    await send_log(websocket, "ERROR", "Invalid confirmation signature received.")
                    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WS error: {e}", flush=True)
        manager.disconnect(websocket)

# Serve static HUD frontend files on HTTP to ensure permanent microphone permissions
@app.get("/{filename:path}")
async def get_static_file(filename: str):
    if not filename:
        filename = "index.html"
    file_path = os.path.join("src", filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    return FileResponse("src/index.html")

# FastAPI startup hook to trigger vitals monitoring task
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(monitor_vitals_loop())

if __name__ == "__main__":
    import uvicorn
    # Listen on localhost port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
