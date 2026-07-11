import sqlite3
import os
import datetime


class RemindersCore:
    def __init__(self, db_path=None):
        if db_path is None:
            db_dir = os.path.dirname(os.path.abspath(__file__))
            self.db_path = os.path.join(db_dir, "jarvis.db")
        else:
            self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                fire_at TEXT NOT NULL,
                fired INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

    def set_reminder(self, text: str, seconds_from_now: int) -> dict:
        """Schedule a reminder to fire after `seconds_from_now` seconds."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        fire_at = (datetime.datetime.now() + datetime.timedelta(seconds=seconds_from_now)).isoformat()
        cursor.execute(
            "INSERT INTO reminders (text, fire_at, fired) VALUES (?, ?, 0)",
            (text, fire_at)
        )
        conn.commit()
        rid = cursor.lastrowid
        conn.close()
        return {"status": "success", "reminder_id": rid, "fires_at": fire_at, "message": f"Reminder set: '{text}'"}

    def get_due_reminders(self) -> list:
        """Return all reminders that are due and not yet fired."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        now = datetime.datetime.now().isoformat()
        cursor.execute(
            "SELECT id, text, fire_at FROM reminders WHERE fired = 0 AND fire_at <= ?",
            (now,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [{"id": r[0], "text": r[1], "fire_at": r[2]} for r in rows]

    def mark_fired(self, reminder_id: int):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("UPDATE reminders SET fired = 1 WHERE id = ?", (reminder_id,))
        conn.commit()
        conn.close()

    def list_pending(self) -> list:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        now = datetime.datetime.now().isoformat()
        cursor.execute(
            "SELECT id, text, fire_at FROM reminders WHERE fired = 0 AND fire_at > ? ORDER BY fire_at ASC",
            (now,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [{"id": r[0], "text": r[1], "fire_at": r[2]} for r in rows]
