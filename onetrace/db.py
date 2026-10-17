"""Engine construction and session helpers.

The app keeps its engine on ``app.state.engine`` (see ``main.create_app``) so tests can build an
app around an in-memory database without touching globals.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from onetrace.config import REPO_ROOT

MEMORY_URLS = {"sqlite://", "sqlite:///:memory:"}
_SQLITE_FILE_PREFIX = "sqlite:///"


def resolve_sqlite_url(url: str) -> str:
    """Anchor relative SQLite file paths at the repo root so the DB does not move with the CWD."""
    if url in MEMORY_URLS or not url.startswith(_SQLITE_FILE_PREFIX):
        return url
    raw = url[len(_SQLITE_FILE_PREFIX) :]
    if raw.startswith("/"):
        return url
    path = (REPO_ROOT / raw.removeprefix("./")).resolve()
    return f"{_SQLITE_FILE_PREFIX}{path}"


def make_engine(database_url: str, *, echo: bool = False) -> Engine:
    url = resolve_sqlite_url(database_url)
    kwargs: dict = {"echo": echo}
    is_sqlite = url.startswith("sqlite")
    if is_sqlite:
        kwargs["connect_args"] = {"check_same_thread": False}
        if url in MEMORY_URLS:
            kwargs["poolclass"] = StaticPool  # one shared connection, so tests see one DB
        else:
            Path(url[len(_SQLITE_FILE_PREFIX) :]).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **kwargs)
    if is_sqlite:

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            if url not in MEMORY_URLS:
                cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    return engine


def init_db(engine: Engine) -> None:
    import onetrace.models  # noqa: F401  (registers every table on SQLModel.metadata)

    SQLModel.metadata.create_all(engine)


def drop_db(engine: Engine) -> None:
    import onetrace.models  # noqa: F401

    SQLModel.metadata.drop_all(engine)
