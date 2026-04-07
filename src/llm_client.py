"""
llm_client.py - Generic OpenAI-compatible LLM client for the Minecraft Agent.

Loads the bot personality from personality.md, builds a chat-completion request
with the recent message history as context, and returns the model's reply.
All errors are caught and mapped to short, in-character fallback messages so
the bot never goes silent from a player's perspective.
"""

import os
import sys

import requests

from config import config

# ── Project root (one level above this file's src/ directory) ─────────────────
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PERSONALITY_PATH = os.path.join(_PROJECT_ROOT, "personality.md")

# ── In-character error messages (hardcoded — not LLM generated) ───────────────
_ERR_TIMEOUT    = "*confused* I... I can't think right now..."
_ERR_CONNECTION = "*dizzy* My thoughts are scattered..."
_ERR_AUTH       = "*scratches head* Something's wrong with my brain..."
_ERR_GENERIC    = "*blinks* Something went wrong... try again?"


# ── Personality loading ────────────────────────────────────────────────────────

def load_personality() -> str:
    """Read personality.md and return the system-prompt section.

    Everything after the first ``---`` separator is treated as the prompt;
    the HTML comment block above it is documentation for humans only.
    Returns a plain fallback string if the file cannot be read.
    """
    try:
        with open(_PERSONALITY_PATH, "r", encoding="utf-8") as fh:
            content = fh.read()
        # Split on the first markdown horizontal rule and take what follows
        parts = content.split("\n---\n", maxsplit=1)
        if len(parts) == 2:
            return parts[1].strip()
        # No separator found — use the whole file as-is
        return content.strip()
    except OSError as exc:
        print(f"[WARN] Could not load personality.md: {exc}", file=sys.stderr)
        return "You are a helpful Minecraft bot."


# ── Message construction ───────────────────────────────────────────────────────

def _build_messages(personality: str, llm_context: str, username: str, text: str) -> list:
    """Assemble the messages array for the chat-completions endpoint.

    Layout:
      system  — personality + temporal/chat context
      user    — the player's current message
    """
    system_content = personality
    if llm_context:
        system_content = f"{personality}\n\n{llm_context}"

    return [
        {"role": "system",  "content": system_content},
        {"role": "user",    "content": f"{username}: {text}"},
    ]


# ── API call ───────────────────────────────────────────────────────────────────

def get_response(username: str, text: str, llm_context: str) -> str:
    """Call the LLM and return the reply text.

    Args:
        username:    The Minecraft player who sent the message.
        text:        The message content (with the @mention already stripped).
        llm_context: The formatted history + current-time block from
                     MessageHistory.build_llm_context().

    Returns:
        The model's reply string, or an in-character error message on failure.
    """
    personality = load_personality()
    messages = _build_messages(personality, llm_context, username, text)

    url = f"{config.llm_api_base.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.llm_api_key}",
    }
    payload = {
        "model":       config.llm_model,
        "messages":    messages,
        "temperature": config.llm_temperature,
        "max_tokens":  config.llm_max_tokens,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        # Surface auth errors before calling raise_for_status so we can give
        # a specific in-character message rather than a generic one
        if response.status_code in (401, 403):
            print(
                f"[ERROR] LLM auth error {response.status_code}: {response.text[:200]}",
                file=sys.stderr,
            )
            return _ERR_AUTH

        response.raise_for_status()

        data = response.json()
        reply = data["choices"][0]["message"]["content"].strip()
        return reply

    except requests.exceptions.Timeout:
        print("[ERROR] LLM request timed out.", file=sys.stderr)
        return _ERR_TIMEOUT

    except requests.exceptions.ConnectionError as exc:
        print(f"[ERROR] LLM connection error: {exc}", file=sys.stderr)
        return _ERR_CONNECTION

    except requests.exceptions.HTTPError as exc:
        print(f"[ERROR] LLM HTTP error: {exc}", file=sys.stderr)
        return _ERR_GENERIC

    except (KeyError, IndexError, ValueError) as exc:
        print(f"[ERROR] Unexpected LLM response format: {exc}", file=sys.stderr)
        return _ERR_GENERIC

    except Exception as exc:
        print(f"[ERROR] Unexpected error calling LLM: {exc}", file=sys.stderr)
        return _ERR_GENERIC
