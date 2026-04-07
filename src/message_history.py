"""
message_history.py - Chat message tracking and LLM context generation.

Stores the last N chat messages (all players + the bot itself) as a circular
buffer and formats them for inclusion in LLM prompts.  Timestamps are plain
ISO 8601 strings; the LLM is expected to infer time deltas itself rather than
having them pre-computed here.
"""

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class ChatMessage:
    """A single chat entry stored in the history buffer."""
    timestamp: str   # ISO 8601, UTC
    username: str
    message: str


class MessageHistory:
    """Circular buffer of the most recent chat messages.

    Args:
        max_size: Maximum number of messages to retain (maps to
                  CONTEXT_MESSAGE_COUNT in config).
    """

    def __init__(self, max_size: int) -> None:
        self._history: deque[ChatMessage] = deque(maxlen=max_size)

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    def add(self, username: str, message: str) -> None:
        """Append a message to the history with the current UTC timestamp."""
        self._history.append(ChatMessage(
            timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            username=username,
            message=message,
        ))

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    @staticmethod
    def current_time() -> str:
        """Return the current UTC time as an ISO 8601 string."""
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def format_history(self) -> str:
        """Return the history as newline-separated 'timestamp username: message' lines."""
        return "\n".join(
            f"{msg.timestamp} {msg.username}: {msg.message}"
            for msg in self._history
        )

    def build_llm_context(self) -> str:
        """Build the context block that is injected into every LLM system prompt.

        Format::

            Current time: <ISO 8601>

            Recent chat:
            <timestamp> <username>: <message>
            ...

        Returns an empty string if the history is empty.
        """
        current = self.current_time()
        history_text = self.format_history()

        parts = [f"Current time: {current}"]
        if history_text:
            parts.append(f"Recent chat:\n{history_text}")

        return "\n\n".join(parts)

    def __len__(self) -> int:
        return len(self._history)
