import sqlite3
import os
import datetime

class MemoryCore:
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
        
        # Conversation history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                role TEXT,
                content TEXT
            )
        """)
        
        # Facts / Long-term memory table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact_text TEXT UNIQUE,
                timestamp TEXT
            )
        """)
        
        # Action execution log table for safety audit trail
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS action_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                tool_name TEXT,
                parameters TEXT,
                permission_tier INTEGER,
                authorized INTEGER,
                outcome TEXT
            )
        """)
        
        conn.commit()
        conn.close()

    def save_message(self, role, content):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        timestamp = datetime.datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO conversation_history (timestamp, role, content) VALUES (?, ?, ?)",
            (timestamp, role, content)
        )
        conn.commit()
        conn.close()

    def get_recent_history(self, limit=10):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT role, content FROM conversation_history ORDER BY id DESC LIMIT ?",
            (limit,)
        )
        rows = cursor.fetchall()
        conn.close()
        # Return in chronological order
        return [{"role": r, "content": c} for r, c in reversed(rows)]

    def save_fact(self, fact_text):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        timestamp = datetime.datetime.now().isoformat()
        try:
            cursor.execute(
                "INSERT INTO facts (fact_text, timestamp) VALUES (?, ?)",
                (fact_text, timestamp)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Fact already exists
            pass
        finally:
            conn.close()

    def delete_fact(self, fact_text):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM facts WHERE fact_text = ?", (fact_text,))
        conn.commit()
        conn.close()

    def get_all_facts(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT fact_text FROM facts ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        return [r[0] for r in rows]

    def log_action(self, tool_name, parameters, permission_tier, authorized, outcome):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        timestamp = datetime.datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO action_audit_log (timestamp, tool_name, parameters, permission_tier, authorized, outcome) VALUES (?, ?, ?, ?, ?, ?)",
            (timestamp, tool_name, str(parameters), permission_tier, 1 if authorized else 0, outcome)
        )
        conn.commit()
        conn.close()

    def get_action_logs(self, limit=50):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT timestamp, tool_name, parameters, permission_tier, authorized, outcome FROM action_audit_log ORDER BY id DESC LIMIT ?",
            (limit,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [{
            "timestamp": r[0],
            "tool": r[1],
            "params": r[2],
            "tier": r[3],
            "authorized": bool(r[4]),
            "outcome": r[5]
        } for r in rows]
