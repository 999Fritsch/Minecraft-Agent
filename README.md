# Minecraft Agent

An AI-powered Minecraft bot that responds to chat mentions with LLM-generated replies, follows players around the world, and loads its personality from a plain markdown file. Everything runs inside a lightweight Docker container.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+, included in Docker Desktop)
- A running Minecraft Java Edition server (local or remote)
- An OpenAI-compatible LLM API endpoint (see [LLM Providers](#llm-providers))

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd Minecraft-Agent

# 2. Create your configuration file
cp .env.example .env

# 3. Edit .env — at minimum set your server host and LLM credentials
#    See Configuration below for all options
nano .env

# 4. Build and start the bot
docker-compose up --build
```

The bot will connect to your server and announce itself in chat. Press `Ctrl+C` to stop.

To run in the background:
```bash
docker-compose up --build -d
docker-compose logs -f   # tail logs
docker-compose down      # stop
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the values. All settings are documented in `.env.example`; a summary is below.

### Minecraft Server

| Variable | Default | Description |
|---|---|---|
| `MC_SERVER_HOST` | *(required)* | Hostname or IP of the Minecraft server |
| `MC_SERVER_PORT` | `25565` | Server port |
| `MC_BOT_USERNAME` | *(required)* | In-game username for the bot |
| `MC_AUTH_TYPE` | `offline` | `offline` for cracked/LAN servers, `microsoft` for official accounts |

### LLM Provider

| Variable | Default | Description |
|---|---|---|
| `LLM_API_BASE` | *(required)* | Base URL of an OpenAI-compatible API |
| `LLM_API_KEY` | *(required)* | API key (any non-empty string works for local providers) |
| `LLM_MODEL` | `gpt-4o` | Model identifier |
| `LLM_TEMPERATURE` | `0.7` | Sampling temperature (0.0 = deterministic, 1.0 = creative) |
| `LLM_MAX_TOKENS` | `150` | Max tokens per response |

### Bot Behaviour

| Variable | Default | Description |
|---|---|---|
| `BOT_OWNER` | *(empty)* | Username allowed to issue privileged commands (follow me). Leave empty to allow anyone. |
| `FOLLOW_DISTANCE` | `2` | Blocks to maintain from the followed player |
| `RESPONSE_DELAY_MS` | `1000` | Milliseconds to wait before replying (avoids spam kicks) |
| `CONTEXT_MESSAGE_COUNT` | `5` | Recent chat messages sent to the LLM as context |

---

## LLM Providers

The bot uses the OpenAI chat-completions API format, so any compatible provider works.

**OpenAI**
```env
LLM_API_BASE=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

**Ollama** (local, no API key needed)
```env
LLM_API_BASE=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3
```

**LM Studio** (local)
```env
LLM_API_BASE=http://host.docker.internal:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=local-model
```

> **Note:** When the bot runs inside Docker and the LLM server runs on your host machine, use `host.docker.internal` instead of `localhost`.

---

## Customizing the Bot's Personality

Edit `personality.md` in the project root. Everything after the `---` separator becomes the LLM system prompt — it controls tone, knowledge, and behaviour.

```markdown
---
You are CaveDweller, a gruff but helpful bot who speaks in riddles
and loves diamond ore above all else. Keep replies under 2 sentences.
```

Tips:
- Match the bot's name in the prompt to `MC_BOT_USERNAME` in `.env`.
- Keep it concise — every token here reduces the budget for actual replies.
- Include server-specific lore or rules the bot should know.
- Restart the container after saving changes: `docker-compose restart`

---

## Available Commands

All commands are issued in Minecraft chat.

| Command | Who can use | Description |
|---|---|---|
| `@BotName <message>` | Anyone | Chat with the bot; replies via LLM |
| `@BotName follow me` | Owner only* | Bot starts following you continuously |
| `@BotName stop` | Anyone | Bot stops following |

*If `BOT_OWNER` is unset, anyone can issue the follow command.

---

## Development Workflow

The project directory is mounted into the container as a volume, so Python source changes are reflected without rebuilding:

```bash
# Start once with a full build
docker-compose up --build -d

# Edit src/*.py or personality.md, then restart the service
docker-compose restart

# View live logs
docker-compose logs -f
```

Node packages and Python packages are installed inside the container at build time, so you only need to rebuild when `requirements.txt` or `package.json` changes:

```bash
docker-compose up --build
```

---

## Troubleshooting

**Bot connects but never responds to mentions**
- Make sure you are typing `@BotName` with the exact username set in `MC_BOT_USERNAME`.
- Check container logs for `[ERROR]` lines — the LLM endpoint might be unreachable.

**`LLM_API_BASE` connection refused**
- If using a local provider (Ollama, LM Studio) from inside Docker, replace `localhost` with `host.docker.internal`.
- Ensure the local LLM server is running before starting the bot.

**Bot is kicked for spam**
- Increase `RESPONSE_DELAY_MS` (e.g. `2000`).
- Reduce `LLM_MAX_TOKENS` so replies are shorter.

**`MC_AUTH_TYPE=microsoft` — bot can't log in**
- Microsoft auth requires the bot account to be a legitimate Minecraft account. Follow the Mineflayer authentication docs and ensure the account credentials are available in the environment.

**Missing required environment variable on startup**
- The bot exits immediately with `[ERROR] Required environment variable '...' is not set.`
- Copy `.env.example` to `.env` and fill in all required fields.

**Changes to `personality.md` have no effect**
- Restart the container: `docker-compose restart`

---

## Project Structure

```
Minecraft-Agent/
├── src/
│   ├── main.py           # Entry point: bot init, event handlers
│   ├── config.py         # Environment variable loading & validation
│   ├── llm_client.py     # OpenAI-compatible LLM API client
│   ├── message_history.py# Circular chat buffer + LLM context builder
│   └── bot_actions.py    # Reusable action primitives (follow, stop, chat)
├── personality.md        # Bot system prompt — edit to change personality
├── .env.example          # Configuration template
├── Dockerfile            # Alpine + Python 3.11 + Node.js 20
├── docker-compose.yml    # Service definition with volume mounts
├── requirements.txt      # Python dependencies
└── package.json          # Node.js dependencies (mineflayer)
```

---

## Future Enhancements

- **Persistent memory** — remember player preferences across restarts (SQLite/Redis)
- **Tool use** — let the LLM trigger in-game actions (mine, build, craft)
- **Vision** — describe what the bot currently sees in the world
- **Web dashboard** — monitor bot status and chat history in a browser
- **Natural language commands** — parse complex instructions beyond simple keywords
- **Automated tasks** — farming, resource gathering on a schedule
