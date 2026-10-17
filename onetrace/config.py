"""Application settings.

Every value can be overridden with a ``ONETRACE_*`` environment variable or a ``.env`` file at
the repo root (see ``.env.example``). Defaults are safe for local development and the demo.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SECRET_KEY = "dev-only-change-me-in-prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ONETRACE_",
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "OneTrace"
    version: str = "0.1.0"
    env: Literal["dev", "test", "prod"] = "dev"

    # Demo switches. demo_mode enables one-click persona login; auto_seed fills an empty DB.
    demo_mode: bool = True
    auto_seed: bool = True

    # Auth
    secret_key: str = DEFAULT_SECRET_KEY
    session_ttl_minutes: int = 720
    session_cookie_name: str = "onetrace_session"
    secure_cookies: bool | None = None  # None -> True in prod, False otherwise

    # Storage. Relative SQLite paths are anchored at the repo root (see db.resolve_sqlite_url).
    database_url: str = "sqlite:///./data/onetrace.db"

    # HTTP
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    static_dir: Path = Path("frontend/dist")
    max_body_mb: int = 10
    log_level: str = "info"

    # Access rules (RUL-1) and break-glass (VLT-7). Off-hours is judged in this timezone.
    timezone: str = "America/Chicago"
    off_hours_start: int = 22  # 22:00 .. 06:00 local is "off hours" (MEDIUM, patient alerted)
    off_hours_end: int = 6
    emergency_ttl_minutes: int = 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def cookie_secure(self) -> bool:
        return self.is_prod if self.secure_cookies is None else self.secure_cookies

    @property
    def static_path(self) -> Path:
        return self.static_dir if self.static_dir.is_absolute() else REPO_ROOT / self.static_dir

    @property
    def max_body_bytes(self) -> int:
        return self.max_body_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
