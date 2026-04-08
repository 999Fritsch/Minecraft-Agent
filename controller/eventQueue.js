'use strict';

const CRITICAL = 1;
const HIGH = 2;
const LOW = 3;

const DEBOUNCE_MS = 500;

/**
 * Wire Minecraft bot events to the OpenClaw gateway.
 * Must be called each time a new bot spawns (after reconnect).
 *
 * @param {import('mineflayer').Bot} bot
 * @param {{ send: Function, inject: Function, abort: Function }} gatewayClient
 */
function createEventQueue(bot, gatewayClient) {
  const debounceTimers = new Map();

  function debounce(key, fn) {
    if (debounceTimers.has(key)) {
      clearTimeout(debounceTimers.get(key));
    }
    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      fn();
    }, DEBOUNCE_MS);
    debounceTimers.set(key, timer);
  }

  function emit(event, priority) {
    if (priority === CRITICAL || priority === HIGH) {
      debounce(event.type, async () => {
        try {
          await gatewayClient.abort();
          gatewayClient.send(event);
        } catch (e) {
          console.error('[eventQueue] Error emitting event:', e.message);
        }
      });
    } else if (priority === LOW) {
      gatewayClient.inject(event);
    }
  }

  bot.on('death', () => {
    const pos = bot.entity?.position;
    emit(
      { type: 'death', position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null },
      CRITICAL
    );
  });

  bot.on('kicked', (reason) => {
    emit({ type: 'kicked', reason: String(reason) }, CRITICAL);
  });

  bot.on('health', () => {
    if (bot.health < 6) {
      emit({ type: 'hurt', health: bot.health }, HIGH);
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const isMention = message.toLowerCase().includes(bot.username.toLowerCase());
    const priority = isMention ? HIGH : LOW;
    emit(
      { type: isMention ? 'mention' : 'chat', from: username, message },
      priority
    );
  });
}

module.exports = { createEventQueue };
