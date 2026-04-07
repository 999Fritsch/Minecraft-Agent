"""
main.py - Entry point for the Minecraft Agent bot.

Initialises the Mineflayer bot, loads the pathfinder plugin, and wires up all
event handlers.  Subsequent phases add LLM response generation (Phase 5) and
the player-following system (Phase 6).
"""

import sys
import time

from javascript import On, require

import bot_actions
from config import config
from llm_client import get_response
from message_history import MessageHistory

# ── JavaScript modules ─────────────────────────────────────────────────────────
mineflayer = require("mineflayer")
pathfinder_mod = require("mineflayer-pathfinder")

pathfinder = pathfinder_mod.pathfinder
Movements = pathfinder_mod.Movements
GoalFollow = pathfinder_mod.goals.GoalFollow

# ── Bot instance ───────────────────────────────────────────────────────────────
print(f"[INFO] Connecting to {config.mc_host}:{config.mc_port} as '{config.mc_username}'...")

try:
    bot = mineflayer.createBot({
        "host": config.mc_host,
        "port": config.mc_port,
        "username": config.mc_username,
        "auth": config.mc_auth,
    })
except Exception as exc:
    print(f"[ERROR] Failed to create bot: {exc}", file=sys.stderr)
    sys.exit(1)

# Load the pathfinder plugin so follow/navigation is available from the start
bot.loadPlugin(pathfinder)

# ── Global state ──────────────────────────────────────────────────────────────
# Circular buffer of the last N chat messages, used as LLM context (Phase 5)
history = MessageHistory(max_size=config.context_msg_count)

# Username currently being followed, or None
follow_target: str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────
def _send_chat(message: str) -> None:
    """Send a chat message and record it in the history for LLM context."""
    bot.chat(message)
    history.add(config.mc_username, message)


def _mention_prefix() -> str:
    """Return the @mention string to watch for (lower-cased)."""
    return f"@{config.mc_username.lower()}"


def _is_mention(message: str) -> bool:
    """Return True if the message starts with @botname (case-insensitive)."""
    return message.strip().lower().startswith(_mention_prefix())


def _strip_mention(message: str) -> str:
    """Remove the leading @botname from a message and return the remainder."""
    prefix = _mention_prefix()
    return message.strip()[len(prefix):].strip()


# ── Event: spawn ───────────────────────────────────────────────────────────────
@On(bot, "spawn")
def on_spawn(this):
    print("[INFO] Bot spawned successfully.")
    _send_chat("Hello! I just woke up and I'm ready to help.")


# ── Event: chat ────────────────────────────────────────────────────────────────
@On(bot, "chat")
def on_chat(this, username, message, *args):
    # Record every player message in history (bot's own messages are added
    # explicitly in the send helper below so they appear in context too)
    if username != config.mc_username:
        history.add(username, message)

    # Only respond when explicitly mentioned
    if not _is_mention(message) or username == config.mc_username:
        return

    text = _strip_mention(message)
    print(f"[CHAT] {username} mentioned bot: {text!r}")

    text_lower = text.lower()

    # Follow / stop commands bypass the LLM — handled with hardcoded responses
    if text_lower.startswith("follow"):
        _handle_follow(username)
        return

    if text_lower.startswith("stop"):
        _handle_stop(username)
        return

    # Everything else → LLM response
    reply = get_response(username, text, history.build_llm_context())
    time.sleep(config.response_delay_ms / 1000)
    _send_chat(reply)


# ── Follow / stop command handlers ────────────────────────────────────────────

def _handle_follow(username: str) -> None:
    """Process a 'follow me' command from a player."""
    global follow_target

    # Owner-only guard — reject if BOT_OWNER is set and sender doesn't match
    if config.bot_owner and username.lower() != config.bot_owner.lower():
        _send_chat("Sorry, I only follow my owner!")
        return

    success = bot_actions.follow_player(bot, username, config.follow_distance)
    if success:
        follow_target = username
        print(f"[INFO] Now following {username!r}.")
        _send_chat("Following you!")
    else:
        _send_chat("I don't see you nearby!")


def _handle_stop(username: str) -> None:
    """Process a 'stop' command from a player."""
    global follow_target

    if follow_target is None:
        _send_chat("I'm not following anyone.")
        return

    bot_actions.stop_following(bot)
    print(f"[INFO] Stopped following {follow_target!r} (requested by {username!r}).")
    follow_target = None
    _send_chat("Stopped following.")


# ── Event: playerLeft ──────────────────────────────────────────────────────────
@On(bot, "playerLeft")
def on_player_left(this, player):
    """Stop following if the tracked player disconnects."""
    global follow_target

    try:
        left_username = player.username
    except Exception:
        return

    if follow_target and left_username == follow_target:
        bot_actions.stop_following(bot)
        print(f"[INFO] {left_username!r} left — stopped following.")
        follow_target = None


# ── Event: kicked ──────────────────────────────────────────────────────────────
@On(bot, "kicked")
def on_kicked(this, reason, *args):
    print(f"[WARN] Bot was kicked. Reason: {reason}")


# ── Event: error ───────────────────────────────────────────────────────────────
@On(bot, "error")
def on_error(this, err):
    print(f"[ERROR] Bot error: {err}", file=sys.stderr)


# ── Event: end ─────────────────────────────────────────────────────────────────
@On(bot, "end")
def on_end(this, reason):
    print(f"[INFO] Connection ended. Reason: {reason}")


# ── Keep-alive ─────────────────────────────────────────────────────────────────
# The JavaScript event loop runs on a background thread via JSPyBridge.
# The main Python thread must stay alive for event handlers to keep firing.
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n[INFO] Shutting down.")
    sys.exit(0)
