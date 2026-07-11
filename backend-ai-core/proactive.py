"""
JARVIS Proactive Background Agent
Monitors system state and fires unsolicited alerts to the HUD WebSocket connection.
"""
import asyncio
import psutil
import json


class ProactiveAgent:
    def __init__(self, reminders_core, broadcast_func):
        """
        :param reminders_core: RemindersCore instance
        :param broadcast_func: async coroutine function to broadcast a message to all clients
        """
        self.reminders = reminders_core
        self.broadcast = broadcast_func
        self._battery_warned_20 = False
        self._battery_warned_10 = False
        self._cpu_high_ticks = 0

    async def _send_alert(self, alert_type: str, title: str, message: str, speak: str):
        payload = json.dumps({
            "type": "proactive_alert",
            "alert_type": alert_type,
            "title": title,
            "message": message,
            "speak": speak
        })
        await self.broadcast(payload)

    async def check_battery(self):
        try:
            battery = psutil.sensors_battery()
            if battery and not battery.power_plugged:
                pct = battery.percent
                if pct <= 10 and not self._battery_warned_10:
                    self._battery_warned_10 = True
                    await self._send_alert(
                        "battery_critical",
                        "⚠️ Battery Critical",
                        f"Battery at **{pct:.0f}%**. Connect charger immediately.",
                        f"Warning! Battery is at {pct:.0f} percent. Please plug in your charger immediately."
                    )
                elif pct <= 20 and not self._battery_warned_20:
                    self._battery_warned_20 = True
                    await self._send_alert(
                        "battery_low",
                        "🔋 Battery Low",
                        f"Battery at **{pct:.0f}%**. Consider plugging in soon.",
                        f"Heads up! Battery is at {pct:.0f} percent. You may want to plug in soon."
                    )
                # Reset warnings when charging again
                if battery.power_plugged:
                    self._battery_warned_20 = False
                    self._battery_warned_10 = False
        except Exception:
            pass

    async def check_cpu(self):
        try:
            cpu = psutil.cpu_percent(interval=None)
            if cpu > 90:
                self._cpu_high_ticks += 1
            else:
                self._cpu_high_ticks = 0

            # Alert only after 6 consecutive high ticks (~60 seconds at 10s interval)
            if self._cpu_high_ticks == 6:
                await self._send_alert(
                    "cpu_overload",
                    "🔥 CPU Overload Detected",
                    f"CPU has been sustained above 90% for over 60 seconds. Current: **{cpu:.0f}%**.",
                    f"Alert! Your CPU has been running above 90 percent for over a minute. You may want to check running processes."
                )
        except Exception:
            pass

    async def check_reminders(self):
        try:
            due = self.reminders.get_due_reminders()
            for reminder in due:
                self.reminders.mark_fired(reminder["id"])
                await self._send_alert(
                    "reminder",
                    "⏰ Reminder",
                    reminder["text"],
                    f"Reminder! {reminder['text']}"
                )
        except Exception:
            pass

    async def run_loop(self):
        """Main proactive monitoring loop. Runs every 10 seconds."""
        while True:
            await asyncio.sleep(10)
            await self.check_battery()
            await self.check_cpu()
            await self.check_reminders()
