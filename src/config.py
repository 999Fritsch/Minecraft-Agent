"""
config.py - Load and validate environment configuration for the Minecraft Agent.

Reads from a .env file (or environment variables already set in the shell/container)
and exposes a single Config dataclass instance used throughout the application.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

# Load .env from the project root (one level above this file's directory)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))


def _require(key: str) -> str:
    """Return the value of a required environment variable or exit with a clear error."""
    value = os.getenv(key, "").strip()
    if not value:
        print(f"[ERROR] Required environment variable '{key}' is not set.", file=sys.stderr)
        print(f"        Copy .env.example to .env and fill in your values.", file=sys.stderr)
        sys.exit(1)
    return value


def _get(key: str, default: str) -> str:
    """Return an optional environment variable, falling back to the given default."""
    return os.getenv(key, default).strip() or default


def _get_int(key: str, default: int) -> int:
    """Return an integer environment variable, falling back to the given default."""
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(
            f"[WARNING] '{key}' must be an integer (got '{raw}'). Using default: {default}",
            file=sys.stderr,
        )
        return default


def _get_float(key: str, default: float) -> float:
    """Return a float environment variable, falling back to the given default."""
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        print(
            f"[WARNING] '{key}' must be a float (got '{raw}'). Using default: {default}",
            file=sys.stderr,
        )
        return default


@dataclass(frozen=True)
class Config:
    # --- Minecraft server ---
    mc_host: str          # MC_SERVER_HOST  - hostname or IP of the server
    mc_port: int          # MC_SERVER_PORT  - port (default 25565)
    mc_username: str      # MC_BOT_USERNAME - in-game username
    mc_auth: str          # MC_AUTH_TYPE    - "offline" | "microsoft"

    # --- LLM provider ---
    llm_api_base: str     # LLM_API_BASE    - OpenAI-compatible endpoint URL
    llm_api_key: str      # LLM_API_KEY     - API key (any value for local providers)
    llm_model: str        # LLM_MODEL       - model identifier
    llm_temperature: float  # LLM_TEMPERATURE - sampling temperature
    llm_max_tokens: int   # LLM_MAX_TOKENS  - max tokens per response

    # --- Bot behaviour ---
    bot_owner: str        # BOT_OWNER              - privileged player username
    follow_distance: int  # FOLLOW_DISTANCE        - blocks to keep from followed player
    response_delay_ms: int  # RESPONSE_DELAY_MS    - ms to wait before replying in chat
    context_msg_count: int  # CONTEXT_MESSAGE_COUNT - recent messages sent to LLM


def load_config() -> Config:
    """Load, validate, and return the application configuration.

    Exits with a descriptive error if any required variable is missing or invalid.
    """
    return Config(
        # Minecraft server (all required - bot cannot connect without them)
        mc_host=_require("MC_SERVER_HOST"),
        mc_port=_get_int("MC_SERVER_PORT", 25565),
        mc_username=_require("MC_BOT_USERNAME"),
        mc_auth=_get("MC_AUTH_TYPE", "offline"),

        # LLM provider (API key and base URL are required)
        llm_api_base=_require("LLM_API_BASE"),
        llm_api_key=_require("LLM_API_KEY"),
        llm_model=_get("LLM_MODEL", "gpt-4o"),
        llm_temperature=_get_float("LLM_TEMPERATURE", 0.7),
        llm_max_tokens=_get_int("LLM_MAX_TOKENS", 150),

        # Bot behaviour (all have sensible defaults)
        bot_owner=_get("BOT_OWNER", ""),
        follow_distance=_get_int("FOLLOW_DISTANCE", 2),
        response_delay_ms=_get_int("RESPONSE_DELAY_MS", 1000),
        context_msg_count=_get_int("CONTEXT_MESSAGE_COUNT", 5),
    )


# Module-level singleton - import this throughout the application
config = load_config()
