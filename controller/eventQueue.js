'use strict';

// In-memory event queue — drained by the get_events MCP tool on each heartbeat.
const _queue = [];

function pushEvent(event) {
  _queue.push({ ...event, ts: Date.now() });
}

/**
 * Return all pending events and clear the queue.
 * @returns {Array}
 */
function drainEvents() {
  return _queue.splice(0);
}

/**
 * Wire Minecraft bot events into the in-memory event queue.
 * Must be called each time a new bot spawns (after reconnect).
 *
 * @param {import('mineflayer').Bot} bot
 */
function createEventQueue(bot) {
  bot.on('death', () => {
    const pos = bot.entity?.position;
    pushEvent({ type: 'death', position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null });
  });

  bot.on('kicked', (reason) => {
    pushEvent({ type: 'kicked', reason: String(reason) });
  });

  bot.on('health', () => {
    if (bot.health < 6) {
      pushEvent({ type: 'hurt', health: bot.health });
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const isMention = message.toLowerCase().includes(bot.username.toLowerCase());
    pushEvent({ type: isMention ? 'mention' : 'chat', from: username, message });
  });
}

module.exports = { createEventQueue, drainEvents };
