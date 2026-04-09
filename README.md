# Minecraft-Agent

A self-hosted Minecraft AI agent running on a Raspberry Pi. The agent (OpenClaw) controls a Mineflayer bot via a Node.js HTTP controller. Fully bidirectional: the agent sends actions to Minecraft, and Minecraft events wake the agent autonomously.

## Architecture

```
User (WebChat / CLI)
        ↕
 OpenClaw Gateway          ← ws://127.0.0.1:18789
        ↕  (HTTP act-batch + WS events)
 Mineflayer Controller     ← Node.js Express, port 3001
        ↕
 Minecraft Server          ← LAN or playit.gg tunnel
```

## Repository Structure

```
mc-agent/
├── controller/
│   ├── index.js          ← Express server (HTTP endpoints)
│   ├── bot.js            ← Mineflayer bot instance + lifecycle
│   ├── dispatcher.js     ← Action dispatcher with whitelist
│   ├── eventQueue.js     ← Priority queue + debounce
│   └── gatewayClient.js  ← WebSocket client to OpenClaw Gateway
├── skill/
│   ├── SKILL.md          ← OpenClaw skill definition (local setup)
│   └── SKILL.docker.md   ← OpenClaw skill definition (Docker, uses service hostname)
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Setup — Docker Compose (recommended)

Runs OpenClaw and the mc-agent controller as two containers on the same network.
No global npm installs needed.

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
| `MC_VERSION` | Server version (e.g. `1.21.1`) |
| `MC_CONTROLLER_TOKEN` | Bearer token for HTTP auth — set to any secret string |
| `OPENCLAW_TOKEN` | See step 2 below |
| `OPENCLAW_SESSION_KEY` | OpenClaw session key (default: `main`) |
| `CONTROLLER_PORT` | HTTP port (default: 3001) |

### 2. Get the OpenClaw token

Start OpenClaw first and run onboard to generate a token:

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
# look for: [gateway] Connected to OpenClaw gateway
```

### 4. Open the OpenClaw web UI

Navigate to `http://<your-pi-ip>:18789` and start chatting with the agent.

---

## Setup — Manual (local Node.js)

### 1. Clone and install dependencies

```bash
git clone https://github.com/999Fritsch/Minecraft-Agent.git
cd Minecraft-Agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (same variables as above). Leave `OPENCLAW_GATEWAY_URL` unset — it defaults to `ws://127.0.0.1:18789`.

### 3. Set up OpenClaw

```bash
npm install -g openclaw
openclaw onboard        # generates token, sets up gateway
openclaw gateway        # start the gateway (or use systemd/launchd daemon)

# Install the skill
mkdir -p ~/.openclaw/skills/mc-agent
cp skill/SKILL.md ~/.openclaw/skills/mc-agent/SKILL.md

openclaw skills list    # verify skill is loaded
```

### 4. Start the controller

```bash
node controller/index.js
```

Or with pm2:

```bash
npm install -g pm2
pm2 start controller/index.js --name mc-controller
pm2 save
pm2 startup
```

## API

All endpoints except `/health` require `Authorization: Bearer <MC_CONTROLLER_TOKEN>`.

### `GET /health`
Returns `{"ok": true}`. No auth required.

### `GET /state`
Returns current bot state: position, health, food, inventory, nearby players and mobs within 32 blocks.

```json
{
  "connected": true,
  "position": { "x": 10, "y": 64, "z": 20 },
  "health": 20,
  "food": 20,
  "inventory": [{ "name": "diamond_sword", "count": 1, "slot": 36 }],
  "nearbyPlayers": [{ "username": "Steve", "position": {}, "health": 20 }],
  "nearbyMobs": [{ "name": "zombie", "position": {}, "health": 20 }],
  "dimension": "overworld",
  "timeOfDay": 6000
}
```

### `POST /act-batch`
Execute a sequence of actions sequentially.

```json
{
  "actions": [
    { "fn": "chat", "args": ["hello world"] },
    { "fn": "pathfinder.goto", "args": [{ "x": 10, "y": 64, "z": 20 }] }
  ]
}
```

**Available actions:**

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
| `setControlState` | `[control, state]` | Set movement control state |
| `clearControlStates` | `[]` | Clear all control states |
| `activateBlock` | `[{x,y,z}]` | Right-click block |
| `activateItem` | `[]` | Use held item |
| `deactivateItem` | `[]` | Stop using held item |
| `equip` | `[itemName, slot]` | Equip item to slot |
| `unequip` | `[slot]` | Unequip from slot |
| `toss` | `[itemName, count]` | Drop item(s) |

## Validation Checklist

```bash
# 1. Health check
curl http://localhost:3001/health
# → {"ok":true}

# 2. Bot state (replace TOKEN)
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/state
# → {"connected":true, "position": ...}

# 3. Send a chat message
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actions":[{"fn":"chat","args":["hello"]}]}' \
  http://localhost:3001/act-batch
# → bot says "hello" in-game

# 4. Open WebChat at http://127.0.0.1:18789/
#    Ask: "what is the bot's current position?"
#    → agent calls GET /state and reports back

# 5. Kill bot in-game
#    → agent receives [MC_EVENT] {"type":"death",...} and responds autonomously
```

## Notes

- `MC_VERSION` must exactly match your Minecraft server version
- In Docker, the `OPENCLAW_GATEWAY_URL` is set automatically by `docker-compose.yml` — do not override it in `.env`
- Port 3001 is internal to the Docker network; only port 18789 is exposed to the host
- Do not expose port 18789 to the internet — use Tailscale for remote access
- OpenClaw session key defaults to `main` — verify with `openclaw sessions list` (or `docker compose exec openclaw openclaw sessions list`)
