"""Local report store for the Tourism agent.

The agent owns its own reports end to end: the SQLite file here is the record,
and the PDF itself stays on disk under ``generated/``. Nothing about a report
lives in a consumer's database -- the admin panel and the stockholder portal
read this through the HTTP API and keep their own Supabase data separate.

SQLite is deliberate: this is a single-process FastAPI app with a handful of
rows per week, so a file next to the PDFs it indexes beats standing up a second
service. Every call opens its own short-lived connection, which keeps the store
safe to touch from the thread pool without a shared-connection lock.
"""
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Sits beside ``generated/`` so the database and the PDFs it points at move
# together. TAWANI_DB_PATH overrides it, which is what the container does: the
# file has to live on a mounted volume, and mounting one over ``quality_bot/``
# itself would shadow the application code.
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.getenv("TAWANI_DB_PATH") or os.path.join(_BASE_DIR, "tawani.db")

REPORT_TYPES = ("daily", "weekly", "monthly", "magazine")

# Fallback titles, so a generated report is presentable without the caller
# supplying anything. Arabic is the user-facing language; English is for the
# admin panel's LTR mode.
DEFAULT_TITLES = {
    "daily":    ("التقرير السياحي اليومي",   "Daily Tourism Report"),
    "weekly":   ("التقرير السياحي الأسبوعي", "Weekly Tourism Report"),
    "monthly":  ("التقرير السياحي الشهري",   "Monthly Tourism Report"),
    "magazine": ("المجلة السياحية الشهرية",   "Monthly Tourism Magazine"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL lets the portal's reads proceed while a generation run is writing.
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    """Create the schema. Idempotent; called once at API startup."""
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id             TEXT PRIMARY KEY,
                report_type    TEXT NOT NULL,
                title_ar       TEXT NOT NULL,
                title_en       TEXT NOT NULL,
                summary_ar     TEXT,
                summary_en     TEXT,
                pdf_file       TEXT,
                article_count  INTEGER,
                enhanced_count INTEGER,
                generated_at   TEXT NOT NULL,
                is_published   INTEGER NOT NULL DEFAULT 0,
                published_at   TEXT
            )
            """
        )
        # The portal's only query is "published, newest first".
        conn.execute(
            "CREATE INDEX IF NOT EXISTS reports_published_idx "
            "ON reports (is_published, published_at DESC)"
        )


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    # SQLite has no boolean type; present one at the API boundary.
    data["is_published"] = bool(data["is_published"])
    return data


def create_report(
    report_type: str,
    pdf_file: Optional[str],
    article_count: Optional[int] = None,
    enhanced_count: Optional[int] = None,
    title_ar: Optional[str] = None,
    title_en: Optional[str] = None,
) -> Dict[str, Any]:
    """Record a freshly generated report. Unpublished until explicitly released."""
    default_ar, default_en = DEFAULT_TITLES.get(report_type, ("تقرير", "Report"))
    report_id = uuid.uuid4().hex

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO reports (
                id, report_type, title_ar, title_en, pdf_file,
                article_count, enhanced_count, generated_at, is_published
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                report_id,
                report_type,
                title_ar or default_ar,
                title_en or default_en,
                pdf_file,
                article_count,
                enhanced_count,
                _now(),
            ),
        )

    report = get_report(report_id)
    assert report is not None  # just inserted
    return report


def list_reports(
    published_only: bool = False,
    report_type: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    clauses, params = [], []
    if published_only:
        clauses.append("is_published = 1")
    if report_type:
        clauses.append("report_type = ?")
        params.append(report_type)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    # Published reports order by release date; drafts have none, so fall back to
    # generation time rather than sorting every draft to the bottom on NULL.
    sql = (
        f"SELECT * FROM reports {where} "
        "ORDER BY COALESCE(published_at, generated_at) DESC LIMIT ?"
    )
    params.append(limit)

    with _connect() as conn:
        return [_row_to_dict(r) for r in conn.execute(sql, params).fetchall()]


def get_report(report_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    return _row_to_dict(row) if row else None


def update_report(
    report_id: str,
    is_published: Optional[bool] = None,
    title_ar: Optional[str] = None,
    title_en: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Patch the mutable fields. Publishing stamps `published_at`, unpublishing clears it."""
    sets, params = [], []

    if is_published is not None:
        sets.append("is_published = ?")
        params.append(1 if is_published else 0)
        sets.append("published_at = ?")
        params.append(_now() if is_published else None)
    if title_ar is not None:
        sets.append("title_ar = ?")
        params.append(title_ar)
    if title_en is not None:
        sets.append("title_en = ?")
        params.append(title_en)

    if not sets:
        return get_report(report_id)

    params.append(report_id)
    with _connect() as conn:
        cursor = conn.execute(f"UPDATE reports SET {', '.join(sets)} WHERE id = ?", params)
        if cursor.rowcount == 0:
            return None

    return get_report(report_id)


def delete_report(report_id: str, generated_dir: str) -> bool:
    """Remove the row and its PDF. Returns False if the report did not exist."""
    report = get_report(report_id)
    if report is None:
        return False

    with _connect() as conn:
        conn.execute("DELETE FROM reports WHERE id = ?", (report_id,))

    # Best effort: the row is gone either way, and a missing file is not an error.
    if report.get("pdf_file"):
        try:
            os.unlink(os.path.join(generated_dir, report["pdf_file"]))
        except OSError:
            pass

    return True
