'use strict';

const mineflayer = require('mineflayer');

let currentBot = null;
const botCreatedCallbacks = [];

/**
 * Register a callback that fires each time a new bot has spawned and is ready.
 * Used by eventQueue and other modules to re-wire event listeners after reconnect.
 * @param {(bot: import('mineflayer').Bot) => void} fn
 */
function onBotCreated(fn) {
  botCreatedCallbacks.push(fn);
}

/**
 * Returns the active bot instance, or null if not connected.
 * @returns {import('mineflayer').Bot | null}
 */
function getBot() {
  return currentBot;
}

function createBot() {
  const authMode = process.env.MC_AUTH ?? 'offline';
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT ?? '25565', 10),
    username: process.env.MC_USERNAME ?? 'AgentBot',
    version: process.env.MC_VERSION ?? '1.21.1',
    auth: authMode,
    ...(authMode === 'microsoft' && { profilesFolder: '/app/auth-cache' }),
  });

  bot.once('spawn', () => {
    // Load pathfinder inside spawn — required by mineflayer-pathfinder
    const { pathfinder, Movements } = require('mineflayer-pathfinder');
    bot.loadPlugin(pathfinder);
    const movements = new Movements(bot);
    bot.pathfinder.setMovements(movements);

    currentBot = bot;
    console.log('[bot] Spawned as', bot.username);

    // Notify all registered listeners that a fresh bot is ready
    for (const cb of botCreatedCallbacks) {
      try { cb(bot); } catch (e) { console.error('[bot] onBotCreated callback error:', e); }
    }
  });

  bot.on('end', (reason) => {
    console.log('[bot] Disconnected:', reason);
    currentBot = null;
    setTimeout(createBot, 5000);
  });

  bot.on('error', (err) => {
    console.error('[bot] Error:', err.message);
  });

  bot.on('kicked', (reason) => {
    console.warn('[bot] Kicked:', reason);
  });
}

module.exports = { createBot, getBot, onBotCreated };
