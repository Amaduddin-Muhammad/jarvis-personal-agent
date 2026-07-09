import sqlite3
import os
import datetime


class NotesCore:
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
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.commit()
        conn.close()

    def write_note(self, title: str, content: str) -> dict:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        now = datetime.datetime.now().isoformat()
        try:
            cursor.execute(
                """INSERT INTO notes (title, content, created_at, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(title) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at""",
                (title, content, now, now)
            )
            conn.commit()
            return {"status": "success", "message": f"Note '{title}' saved."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
        finally:
            conn.close()

    def read_note(self, title: str) -> dict:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT title, content, updated_at FROM notes WHERE title = ?", (title,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"status": "success", "title": row[0], "content": row[1], "updated_at": row[2]}
        return {"status": "error", "message": f"Note '{title}' not found."}

    def list_notes(self) -> dict:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT title, updated_at FROM notes ORDER BY updated_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return {"status": "success", "notes": [{"title": r[0], "updated_at": r[1]} for r in rows]}

    def delete_note(self, title: str) -> dict:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM notes WHERE title = ?", (title,))
        conn.commit()
        affected = cursor.rowcount
        conn.close()
        if affected:
            return {"status": "success", "message": f"Note '{title}' deleted."}
        return {"status": "error", "message": f"Note '{title}' not found."}
