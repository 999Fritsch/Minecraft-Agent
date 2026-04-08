'use strict';

require('dotenv').config();

const express = require('express');
const Vec3 = require('vec3');
const { createBot, getBot, onBotCreated } = require('./bot');
const { dispatch } = require('./dispatcher');
const { createEventQueue } = require('./eventQueue');
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

const gatewayClient = createGatewayClient();

onBotCreated((bot) => {
  createEventQueue(bot, gatewayClient);
});

createBot();

const port = parseInt(process.env.CONTROLLER_PORT ?? '3001', 10);
app.listen(port, () => {
  console.log(`[controller] HTTP server listening on port ${port}`);
});
