# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run the controller (requires .env to be configured)
npm start
# or
node controller/index.js

# Docker Compose (recommended for full stack)
docker compose up -d
docker compose logs -f

# Build the mc-agent Docker image
docker build -t mc-agent:latest .

# Validate the running controller
curl http://localhost:3001/health
curl -H "Authorization: Bearer $MC_CONTROLLER_TOKEN" http://localhost:3001/state
```

## Architecture

The system bridges an OpenClaw AI agent to a Minecraft server via a Mineflayer bot.

```
User (WebChat)
      ↕
OpenClaw Gateway (ws://openclaw:18789 or ws://127.0.0.1:18789)
      ↕  WebSocket (OpenClaw protocol v3)
Mineflayer Controller (Node.js Express, port 3001)
      ↕
Minecraft Server
```

**Data flow — agent → game:** OpenClaw calls `GET /state` then `POST /act-batch` (HTTP with Bearer token). Actions execute sequentially inside `dispatcher.js`.

**Data flow — game → agent:** Minecraft events fire in `eventQueue.js`, which calls `gatewayClient.send()` (critical/high priority, aborts current agent turn first) or `gatewayClient.inject()` (low priority, appended as context). Events arrive in OpenClaw as `[MC_EVENT] {...}` chat messages.

### Key modules

- `controller/index.js` — Express server; wires bot, eventQueue, and gatewayClient together on startup
- `controller/bot.js` — Mineflayer bot lifecycle; auto-reconnects after 5s on disconnect; fires `onBotCreated` callbacks so other modules can re-wire listeners
- `controller/dispatcher.js` — Executes whitelisted bot actions; `WHITELIST` set is the authoritative list of allowed `fn` values
- `controller/eventQueue.js` — Maps Minecraft bot events to prioritized gateway calls; debounces 500ms to avoid flooding
- `controller/gatewayClient.js` — Persistent WebSocket to OpenClaw; reconnects after 3s; implements `send`, `inject`, `abort`

### Gateway protocol

Uses OpenClaw protocol v3. On connect, sends a `connect` message with `auth.token`, protocol range, and `client` object. Event methods: `chat.send` (interrupts agent), `chat.inject` (context only), `chat.abort` (cancel current agent turn).

### Docker notes

In Docker Compose, `OPENCLAW_GATEWAY_URL` is forced to `ws://openclaw:18789` via the `environment` block — do not set it in `.env`. The `mc-agent` image mounts the repo into `/app` and excludes `node_modules` via an anonymous volume. OpenClaw data (identity, sessions, skills) persists in `./openclaw-data/`.

The skill definition used inside Docker is `skill/SKILL.docker.md` (mounted into the OpenClaw container). `skill/SKILL.md` is for local (non-Docker) setup where the base URL is `http://127.0.0.1:3001`.

## Environment Variables

| Variable | Description |
|---|---|
| `MC_HOST` | Minecraft server IP |
| `MC_PORT` | Minecraft server port (default: 25565) |
| `MC_USERNAME` | Bot username |
| `MC_VERSION` | Must exactly match the server version |
| `MC_CONTROLLER_TOKEN` | Bearer token for HTTP auth |
| `OPENCLAW_TOKEN` | Generated via `openclaw onboard` |
| `OPENCLAW_SESSION_KEY` | OpenClaw session key (default: `main`) |
| `OPENCLAW_GATEWAY_URL` | Gateway WS URL (auto-set in Docker) |
| `CONTROLLER_PORT` | HTTP port (default: 3001) |
