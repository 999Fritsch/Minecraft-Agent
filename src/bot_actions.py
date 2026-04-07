"""
bot_actions.py - Reusable bot action primitives.

Each function takes the bot instance (and any required arguments) and performs
a single, well-defined action.  Keeping the implementation here rather than
inline in main.py makes future extensions easier — new capabilities (mining,
building, crafting, etc.) can be added without touching the event-handler logic.
"""

import sys

from javascript import require

# Reuse the already-loaded module (require() caches by name)
_pathfinder_mod = require("mineflayer-pathfinder")
_Movements = _pathfinder_mod.Movements
_GoalFollow = _pathfinder_mod.goals.GoalFollow


# ── Player lookup ──────────────────────────────────────────────────────────────

def get_player_entity(bot, username: str):
    """Return the entity object for an online player, or None if not visible.

    Args:
        bot:      The Mineflayer bot instance.
        username: The player's in-game name.

    Returns:
        The JavaScript entity object, or None if the player is not found or
        their entity is not loaded in the bot's view distance.
    """
    try:
        player = bot.players[username]
        if player is None:
            return None
        entity = player.entity
        return entity if entity is not None else None
    except Exception as exc:
        print(f"[WARN] get_player_entity({username!r}): {exc}", file=sys.stderr)
        return None


# ── Navigation ─────────────────────────────────────────────────────────────────

def follow_player(bot, username: str, follow_distance: int) -> bool:
    """Start continuously following a player using the pathfinder plugin.

    Args:
        bot:             The Mineflayer bot instance (must have pathfinder loaded).
        username:        The player to follow.
        follow_distance: How many blocks away to maintain from the player.

    Returns:
        True if pathfinding was started successfully, False if the player's
        entity could not be found.
    """
    entity = get_player_entity(bot, username)
    if entity is None:
        return False

    try:
        movements = _Movements(bot)
        bot.pathfinder.setMovements(movements)
        # Passing True as the second arg makes the goal dynamic — the pathfinder
        # continuously re-evaluates the target position as the entity moves.
        bot.pathfinder.setGoal(_GoalFollow(entity, follow_distance), True)
        return True
    except Exception as exc:
        print(f"[ERROR] follow_player({username!r}): {exc}", file=sys.stderr)
        return False


def stop_following(bot) -> None:
    """Cancel the current pathfinder goal, stopping all movement.

    Args:
        bot: The Mineflayer bot instance.
    """
    try:
        bot.pathfinder.setGoal(None)
    except Exception as exc:
        print(f"[ERROR] stop_following: {exc}", file=sys.stderr)


# ── Chat ───────────────────────────────────────────────────────────────────────

def send_chat(bot, message: str) -> None:
    """Send a message in game chat.

    Rate-limiting (RESPONSE_DELAY_MS) is applied by the caller in main.py
    before invoking this function.

    Args:
        bot:     The Mineflayer bot instance.
        message: The text to send.
    """
    bot.chat(message)


# ── Future action stubs ────────────────────────────────────────────────────────
# TODO: implement mine_block(bot, position) — dig a target block
# TODO: implement place_block(bot, position, block_type) — place a block
# TODO: implement craft_item(bot, item_name, quantity) — craft from inventory
# TODO: implement go_to(bot, x, y, z) — navigate to absolute coordinates
# TODO: implement collect_item(bot, item_name) — pick up nearby dropped items
