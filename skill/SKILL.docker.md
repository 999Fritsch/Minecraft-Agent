# mc-agent

Control a Mineflayer Minecraft bot via a local HTTP controller.

## Base URL
http://mc-agent:3001

## Auth
All requests require header: `Authorization: Bearer $MC_CONTROLLER_TOKEN`

## Loop pattern
1. GET /state — read current world state
2. Decide a sequence of 3–8 safe actions
3. POST /act-batch — execute actions
4. Repeat or wait for next event

## Endpoints

### GET /state
Returns bot position, health, food, inventory, nearby players and mobs.
Always call this first before deciding actions.

### POST /act-batch
Body: `{ "actions": [ { "fn": string, "args": array } ] }`
Actions execute sequentially. Returns results array.

## Available actions (fn values)

| fn | args | description |
|---|---|---|
| chat | [message: string] | send chat message |
| pathfinder.goto | [{x,y,z}] | move to coordinates |
| pathfinder.stop | [] | stop moving |
| dig | [{x,y,z}] | break block at position |
| placeBlock | [item: string, {x,y,z}] | place block |
| equip | [itemName: string, destination: string] | equip item ("hand", "head", etc.) |
| attack | [entityType: string] | attack nearest entity of type |
| follow | [username: string] | follow a player |
| stopFollowing | [] | stop following |
| jump | [] | jump once |
| lookAt | [{x,y,z}] | look at position |

## Incoming events (from Minecraft → you)
Events arrive prefixed with [MC_EVENT] in chat.send calls:
- `{ type: "death", position: {x,y,z} }` → respawn, assess situation
- `{ type: "kicked", reason: string }` → report to user
- `{ type: "mention", from: string, message: string }` → respond in chat
- `{ type: "hurt", health: number }` → consider fleeing or healing
- `{ type: "chat", from: string, message: string }` → context only, no action required

## Safety rules
- Never run more than 10 actions in a single act-batch call
- Always check /state before digging or placing blocks
- Do not attack players unless explicitly instructed
- If health < 6, prioritize fleeing or finding food before any other task
- Prefer pathfinder.goto over setControlState for movement
