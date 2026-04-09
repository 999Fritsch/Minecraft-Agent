# Minecraft-Agent

A self-hosted Minecraft AI agent running on a Raspberry Pi. The agent (OpenClaw) controls a Mineflayer bot via a Node.js controller. The controller exposes an **MCP server** so the agent can call `get_state`, `act_batch`, and `get_events` as native tools — no exec, no curl, no scope issues.

## Architecture

```
User (WebChat / CLI / Telegram)
        ↕
 OpenClaw Gateway          ← ws://127.0.0.1:18789
        ↕  (MCP HTTP tools)
 Mineflayer Controller     ← Node.js Express, port 3001 (internal)
        ↕
 Minecraft Server          ← LAN or playit.gg tunnel
```

### Agent ↔ Controller (MCP)

The controller runs an MCP server at `POST /mcp`. OpenClaw registers it via `mcp.servers` config and the agent gets three native tools:

| Tool | Description |
|---|---|
| `get_state` | Bot position, health, food, inventory, nearby players/mobs |
| `act_batch` | Execute a sequence of bot actions sequentially (max 10) |
| `get_events` | Drain pending Minecraft events since the last call |

Minecraft events (death, hurt, chat, mention, kicked) are queued in the controller's memory and drained by `get_events` on each heartbeat cycle.

## Repository Structure

```
mc-agent/
├── controller/
│   ├── index.js          ← Express server (REST + MCP endpoints)
│   ├── bot.js            ← Mineflayer bot instance + lifecycle
│   ├── dispatcher.js     ← Action dispatcher with whitelist
│   ├── eventQueue.js     ← In-memory event queue (drained via get_events)
│   └── gatewayClient.js  ← WebSocket client to OpenClaw (receive-only)
├── skill/
│   ├── SKILL.md          ← OpenClaw skill definition (local setup)
│   └── SKILL.docker.md   ← OpenClaw skill definition (Docker, mounted into OpenClaw)
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Setup — Docker Compose (recommended)

### 1. Clone and configure

```bash
git clone https://github.com/999Fritsch/Minecraft-Agent.git
cd Minecraft-Agent
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `MC_HOST` | Minecraft server IP |
| `MC_PORT` | Minecraft server port (default: 25565) |
| `MC_USERNAME` | Bot username |
| `MC_VERSION` | Server version (e.g. `1.21.1`) — must match exactly |
| `MC_CONTROLLER_TOKEN` | Bearer token for HTTP/MCP auth — set to any secret string |
| `OPENCLAW_TOKEN` | See step 2 below |
| `OPENCLAW_SESSION_KEY` | OpenClaw session key (default: `main`) |
| `CONTROLLER_PORT` | HTTP port (default: 3001) |

### 2. Get the OpenClaw token

```bash
docker compose up -d openclaw
docker compose exec openclaw openclaw onboard
```

Copy the printed token into `.env` as `OPENCLAW_TOKEN`.

### 3. Start both services

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f
# look for:
#   [gateway] Connected to OpenClaw gateway
#   [controller] MCP server at POST /mcp
#   [bot] Spawned as <username>
```

### 4. Register the MCP server

This wires the controller's tools into the OpenClaw agent:

```bash
source .env
docker compose exec openclaw openclaw config set \
  "mcp.servers.mc-agent" \
  "{\"url\":\"http://mc-agent:${CONTROLLER_PORT}/mcp\",\"headers\":{\"Authorization\":\"Bearer ${MC_CONTROLLER_TOKEN}\"}}"

docker compose restart openclaw
```

### 5. Open the OpenClaw web UI

Navigate to `http://<your-pi-ip>:18789` and start chatting. The agent now has access to the bot via `get_state`, `act_batch`, and `get_events` tools.

---

## Setup — Manual (local Node.js)

### 1. Install dependencies

```bash
git clone https://github.com/999Fritsch/Minecraft-Agent.git
cd Minecraft-Agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# edit .env — leave OPENCLAW_GATEWAY_URL unset (defaults to ws://127.0.0.1:18789)
```

### 3. Set up OpenClaw

```bash
npm install -g openclaw
openclaw onboard
openclaw gateway   # start the gateway

# Install the skill
mkdir -p ~/.openclaw/skills/mc-agent
cp skill/SKILL.md ~/.openclaw/skills/mc-agent/SKILL.md
```

### 4. Register the MCP server

```bash
source .env
openclaw config set "mcp.servers.mc-agent" \
  "{\"url\":\"http://localhost:${CONTROLLER_PORT}/mcp\",\"headers\":{\"Authorization\":\"Bearer ${MC_CONTROLLER_TOKEN}\"}}"
```

Restart the gateway to apply.

### 5. Start the controller

```bash
node controller/index.js
```

---

## API

All endpoints except `/health` require `Authorization: Bearer <MC_CONTROLLER_TOKEN>`.

### `GET /health`
Returns `{"ok": true}`. No auth required.

### `GET /state`
Returns current bot state (position, health, food, inventory, nearby entities).

### `POST /act-batch`
Execute a sequence of actions. Body: `{"actions": [{"fn": "chat", "args": ["hello"]}]}`

### `POST /mcp`
MCP server endpoint (JSON-RPC 2.0). Used by OpenClaw to call agent tools. Methods: `initialize`, `tools/list`, `tools/call`.

**Available actions for `act_batch` / `act-batch`:**

| fn | args | description |
|---|---|---|
| `chat` | `[message]` | Send chat message |
| `pathfinder.goto` | `[{x,y,z}]` | Move to coordinates |
| `pathfinder.stop` | `[]` | Stop moving |
| `dig` | `[{x,y,z}]` | Break block at position |
| `placeBlock` | `[itemName, {x,y,z}]` | Place block |
| `equip` | `[itemName, destination]` | Equip item (`"hand"`, `"head"`, etc.) |
| `attack` | `[entityType]` | Attack nearest matching entity |
| `follow` | `[username]` | Follow a player |
| `stopFollowing` | `[]` | Stop following |
| `jump` | `[]` | Jump once |
| `lookAt` | `[{x,y,z}]` | Look at position |
| `setControlState` | `[control, state]` | Set movement control |
| `clearControlStates` | `[]` | Clear all control states |
| `activateBlock` | `[{x,y,z}]` | Right-click block |
| `activateItem` | `[]` | Use held item |
| `deactivateItem` | `[]` | Stop using held item |
| `unequip` | `[slot]` | Unequip from slot |
| `toss` | `[itemName, count]` | Drop item(s) |

## Validation Checklist

```bash
# 1. Health check
curl http://localhost:3001/health
# → {"ok":true}

# 2. MCP initialize
curl -s -X POST \
  -H "Authorization: Bearer $MC_CONTROLLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' \
  http://localhost:3001/mcp
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"mc-agent","version":"1.0.0"}}}

# 3. List MCP tools
curl -s -X POST \
  -H "Authorization: Bearer $MC_CONTROLLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  http://localhost:3001/mcp
# → tools: [get_state, act_batch, get_events]

# 4. Open WebChat at http://127.0.0.1:18789/
#    Ask: "what is the bot's current position?"
#    → agent calls get_state tool and reports back (no exec needed)

# 5. Kill bot in-game
#    → event queued; next heartbeat calls get_events and agent responds
```

## Notes

- `MC_VERSION` must exactly match your Minecraft server version
- In Docker, `OPENCLAW_GATEWAY_URL` is set automatically by `docker-compose.yml`
- Port `CONTROLLER_PORT` is internal to the Docker network; only port 18789 is exposed to the host
- Do not expose port 18789 to the internet — use Tailscale for remote access
- The MCP server must be re-registered after changing `MC_CONTROLLER_TOKEN`
- The gateway client connection is receive-only (presence/heartbeat events); event delivery to the agent uses the MCP `get_events` tool instead
