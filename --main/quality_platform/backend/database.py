from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# Use absolute path for SQLite database to avoid issues with working directory
_db_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(_db_dir, exist_ok=True)
_db_path = os.path.join(_db_dir, 'quality_news.db')
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{_db_path}"

_is_sqlite = DATABASE_URL.startswith("sqlite")

# check_same_thread is a SQLite-only concern: FastAPI runs the sync endpoints in
# a thread pool, so connections cross threads.
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args)


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        """Tune SQLite for concurrent readers.

        The default journal mode (`delete`) takes a database-wide lock for every
        write, so a scheduled article fetch blocks every reader until it
        finishes. WAL lets readers continue while a write is in progress, which
        is the common case here: one writer (the scheduler or a report job) and
        several readers (the dashboard polling /api/reports).

        This does not make SQLite multi-writer — that limit is why moving to
        Postgres is the prerequisite for running more than one worker.
        """
        cursor = dbapi_connection.cursor()
        try:
            # Persisted in the database file; re-applied here so a fresh file
            # picks it up too.
            cursor.execute("PRAGMA journal_mode=WAL")
            # Wait up to 10s for a lock instead of failing instantly with
            # "database is locked".
            cursor.execute("PRAGMA busy_timeout=10000")
            # NORMAL is the standard companion to WAL: durable across process
            # crashes, only at risk in an OS-level crash, and much less fsync
            # traffic than FULL.
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
