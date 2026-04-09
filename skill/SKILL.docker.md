# mc-agent

Control a Mineflayer Minecraft bot via MCP tools.

## Tools

Use the MCP tools registered in your config. No auth or base URL needed — they are pre-configured.

### get_state
Returns bot position, health, food, inventory, nearby players and mobs (within 32 blocks).
Always call this first before deciding actions.

### act_batch
Execute a sequence of bot actions sequentially.

Arguments: `{ "actions": [ { "fn": string, "args": array } ] }`

Max 10 actions per call. Returns results array.

### get_events
Drain and return all pending Minecraft events since the last call.
Call this on every heartbeat to check for bot events.

Returns an array of event objects (may be empty).

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

## Event types (from get_events)

- `{ type: "death", position: {x,y,z} }` → bot died; consider respawning and assessing
- `{ type: "kicked", reason: string }` → bot was kicked; report to user
- `{ type: "mention", from: string, message: string }` → someone mentioned the bot; respond in chat
- `{ type: "hurt", health: number }` → health is below 6; consider fleeing or healing
- `{ type: "chat", from: string, message: string }` → context only, no action required

## Safety rules

- Never run more than 10 actions in a single act_batch call
- Always call get_state before digging or placing blocks
- Do not attack players unless explicitly instructed
- If health < 6, prioritize fleeing or finding food before any other task
- Prefer pathfinder.goto over setControlState for movement
