'use strict';

require('dotenv').config();

const express = require('express');
const Vec3 = require('vec3');
const { createBot, getBot, onBotCreated } = require('./bot');
const { dispatch } = require('./dispatcher');
const { createEventQueue, drainEvents } = require('./eventQueue');
const { createGatewayClient } = require('./gatewayClient');

const app = express();
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== process.env.MC_CONTROLLER_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/state', authMiddleware, (req, res) => {
  const bot = getBot();
  if (!bot) {
    return res.json({ connected: false });
  }

  const pos = bot.entity.position;
  const selfPos = new Vec3(pos.x, pos.y, pos.z);
  const RADIUS = 32;

  const nearbyPlayers = [];
  const nearbyMobs = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (!entity.position) continue;
    const dist = selfPos.distanceTo(entity.position);
    if (dist > RADIUS) continue;

    const entityPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };

    if (entity.type === 'player') {
      nearbyPlayers.push({
        username: entity.username ?? entity.name,
        position: entityPos,
        health: entity.metadata?.[9] ?? null,
      });
    } else if (entity.type === 'mob') {
      nearbyMobs.push({
        name: entity.name,
        position: entityPos,
        health: entity.metadata?.[9] ?? null,
      });
    }
  }

  res.json({
    connected: true,
    position: { x: pos.x, y: pos.y, z: pos.z },
    health: bot.health,
    food: bot.food,
    inventory: bot.inventory.items().map((i) => ({
      name: i.name,
      count: i.count,
      slot: i.slot,
    })),
    nearbyPlayers,
    nearbyMobs,
    dimension: bot.game?.dimension ?? null,
    timeOfDay: bot.time?.timeOfDay ?? null,
  });
});

app.post('/act-batch', authMiddleware, async (req, res) => {
  const bot = getBot();
  if (!bot) {
    return res.status(400).json({ error: 'Bot not connected' });
  }

  const { actions } = req.body ?? {};
  if (!Array.isArray(actions)) {
    return res.status(400).json({ error: 'actions must be an array' });
  }

  const results = [];
  for (const action of actions) {
    const { fn, args = [] } = action;
    const outcome = await dispatch(bot, fn, args);
    results.push({ fn, ...outcome });
  }

  res.json({ results });
});

// ---------------------------------------------------------------------------
// MCP server (streamable HTTP transport, JSON-RPC 2.0)
//
// Register in OpenClaw:
//   openclaw config set mcp.servers.mc-agent \
//     '{"url":"http://mc-agent:<PORT>/mcp","headers":{"Authorization":"Bearer <TOKEN>"}}'
//
// The agent gets get_state, act_batch, and get_events as native tools.
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: 'get_state',
    description: "Get the Minecraft bot's current state: position, health, food, inventory, nearby players and mobs within 32 blocks.",
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'act_batch',
    description: 'Execute a sequence of Minecraft bot actions (max 10). Actions run sequentially. Returns results for each action.',
    inputSchema: {
      type: 'object',
      required: ['actions'],
      properties: {
        actions: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            required: ['fn'],
            properties: {
              fn: { type: 'string', description: 'Action name: chat, pathfinder.goto, pathfinder.stop, dig, placeBlock, equip, unequip, toss, attack, follow, stopFollowing, jump, lookAt, setControlState, clearControlStates, activateBlock, activateItem, deactivateItem' },
              args: { type: 'array', description: 'Arguments for the action' },
            },
          },
        },
      },
    },
  },
  {
    name: 'get_events',
    description: 'Drain and return all pending Minecraft events since the last call. Call this on every heartbeat to process bot events. Event types: death, kicked, hurt, chat, mention.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function getBotState() {
  const bot = getBot();
  if (!bot) return { connected: false };

  const pos = bot.entity.position;
  const selfPos = new Vec3(pos.x, pos.y, pos.z);
  const RADIUS = 32;
  const nearbyPlayers = [];
  const nearbyMobs = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity.position) continue;
    if (selfPos.distanceTo(entity.position) > RADIUS) continue;
    const entityPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
    if (entity.type === 'player') {
      nearbyPlayers.push({ username: entity.username ?? entity.name, position: entityPos, health: entity.metadata?.[9] ?? null });
    } else if (entity.type === 'mob') {
      nearbyMobs.push({ name: entity.name, position: entityPos, health: entity.metadata?.[9] ?? null });
    }
  }

  return {
    connected: true,
    position: { x: pos.x, y: pos.y, z: pos.z },
    health: bot.health,
    food: bot.food,
    inventory: bot.inventory.items().map((i) => ({ name: i.name, count: i.count, slot: i.slot })),
    nearbyPlayers,
    nearbyMobs,
    dimension: bot.game?.dimension ?? null,
    timeOfDay: bot.time?.timeOfDay ?? null,
  };
}

// Active SSE connections keyed by sessionId, used to send JSON-RPC responses back
// to the client over the event stream (HTTP+SSE transport).
const sseClients = new Map();

// GET /mcp — establishes the SSE channel for HTTP+SSE transport.
// Sends an "endpoint" event so the client knows where to POST requests.
// Auth is skipped: no sensitive data flows through this stream (only
// keepalive pings and JSON-RPC responses that the client already triggered).
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = Math.random().toString(36).slice(2);
  sseClients.set(sessionId, res);

  // Tell the client where to POST requests (HTTP+SSE transport handshake)
  res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);

  const ping = setInterval(() => res.write(':ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(sessionId);
  });
});

app.post('/mcp', authMiddleware, async (req, res) => {
  const { method, id, params } = req.body ?? {};
  const sessionId = req.query.sessionId;
  const sseRes = sessionId ? sseClients.get(sessionId) : null;

  // For HTTP+SSE transport: send the response via the SSE stream; acknowledge POST with 202.
  // For Streamable HTTP (no sessionId): respond directly in the HTTP body.
  function reply(result) {
    const payload = { jsonrpc: '2.0', id, result };
    if (sseRes) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      return res.status(202).end();
    }
    res.json(payload);
  }
  function replyError(code, message) {
    const payload = { jsonrpc: '2.0', id, error: { code, message } };
    if (sseRes) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      return res.status(202).end();
    }
    res.json(payload);
  }

  if (method === 'initialize') {
    return reply({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mc-agent', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return res.status(204).end();
  }

  if (method === 'tools/list') {
    return reply({ tools: MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params ?? {};

    if (name === 'get_state') {
      const state = getBotState();
      return reply({ content: [{ type: 'text', text: JSON.stringify(state) }] });
    }

    if (name === 'act_batch') {
      const bot = getBot();
      if (!bot) {
        return reply({ content: [{ type: 'text', text: JSON.stringify({ error: 'Bot not connected' }) }], isError: true });
      }
      const actions = args.actions ?? [];
      const results = [];
      for (const action of actions) {
        const outcome = await dispatch(bot, action.fn, action.args ?? []);
        results.push({ fn: action.fn, ...outcome });
      }
      return reply({ content: [{ type: 'text', text: JSON.stringify({ results }) }] });
    }

    if (name === 'get_events') {
      const events = drainEvents();
      return reply({ content: [{ type: 'text', text: JSON.stringify(events) }] });
    }

    return replyError(-32601, `Unknown tool: ${name}`);
  }

  // Unrecognised notification (no id) — ignore silently
  if (!id) return res.status(204).end();

  return replyError(-32601, `Unknown method: ${method}`);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

createGatewayClient();

onBotCreated((bot) => {
  createEventQueue(bot);
});

createBot();

const port = parseInt(process.env.CONTROLLER_PORT ?? '3001', 10);
app.listen(port, () => {
  console.log(`[controller] HTTP server listening on port ${port}`);
  console.log(`[controller] MCP server at POST /mcp`);
});
