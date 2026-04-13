from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
ENV_FILES = (
    PROJECT_ROOT / ".env",
    BASE_DIR / ".env",
)

_env_loaded = False


def _strip_optional_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def load_project_env() -> None:
    global _env_loaded

    if _env_loaded:
        return

    for env_path in ENV_FILES:
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if line.startswith("export "):
                line = line[7:].strip()

            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            normalized_key = key.strip()
            if not normalized_key or normalized_key in os.environ:
                continue

            os.environ[normalized_key] = _strip_optional_quotes(value.strip())

    _env_loaded = True
