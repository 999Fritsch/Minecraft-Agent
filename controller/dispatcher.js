'use strict';

const Vec3 = require('vec3');

const WHITELIST = new Set([
  'chat', 'attack', 'activateBlock', 'activateItem', 'deactivateItem',
  'equip', 'unequip', 'toss', 'dig', 'placeBlock', 'jump',
  'setControlState', 'clearControlStates', 'lookAt', 'follow', 'stopFollowing',
  'pathfinder.goto', 'pathfinder.stop',
]);

function toVec3(obj) {
  if (obj instanceof Vec3) return obj;
  return new Vec3(obj.x, obj.y, obj.z);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findNearestEntity(bot, identifier) {
  let nearest = null;
  let minDist = Infinity;
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const nameMatch = entity.name === identifier || entity.username === identifier;
    if (!nameMatch) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist < minDist) {
      minDist = dist;
      nearest = entity;
    }
  }
  return nearest;
}

async function doPlaceBlock(bot, itemName, posObj) {
  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) throw new Error(`Item not found in inventory: ${itemName}`);
  await bot.equip(item, 'hand');

  const target = toVec3(posObj);

  const faces = [
    new Vec3(0, 1, 0),
    new Vec3(0, -1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];

  for (const face of faces) {
    const neighborPos = target.plus(face);
    const neighbor = bot.blockAt(neighborPos);
    if (neighbor && neighbor.name !== 'air') {
      const faceVec = target.minus(neighborPos);
      await bot.placeBlock(neighbor, faceVec);
      return null;
    }
  }
  throw new Error('No adjacent solid block found to place against');
}

/**
 * Dispatch a single action to the bot.
 * @param {import('mineflayer').Bot} bot
 * @param {string} fn
 * @param {Array} args
 * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
 */
async function dispatch(bot, fn, args = []) {
  if (!WHITELIST.has(fn)) {
    return { ok: false, error: `Action not allowed: ${fn}` };
  }

  try {
    let result = null;
    const { goals } = require('mineflayer-pathfinder');

    switch (fn) {
      case 'chat':
        bot.chat(args[0]);
        break;

      case 'pathfinder.goto': {
        const pos = args[0];
        await bot.pathfinder.goto(new goals.GoalBlock(pos.x, pos.y, pos.z));
        break;
      }

      case 'pathfinder.stop':
        bot.pathfinder.stop();
        break;

      case 'dig': {
        const block = bot.blockAt(toVec3(args[0]));
        if (!block) throw new Error('No block at position');
        await bot.dig(block);
        break;
      }

      case 'placeBlock':
        await doPlaceBlock(bot, args[0], args[1]);
        break;

      case 'activateBlock': {
        const block = bot.blockAt(toVec3(args[0]));
        if (!block) throw new Error('No block at position');
        await bot.activateBlock(block);
        break;
      }

      case 'activateItem':
        bot.activateItem();
        break;

      case 'deactivateItem':
        bot.deactivateItem();
        break;

      case 'equip': {
        const item = bot.inventory.items().find((i) => i.name === args[0]);
        if (!item) throw new Error(`Item not found: ${args[0]}`);
        await bot.equip(item, args[1] ?? 'hand');
        break;
      }

      case 'unequip':
        await bot.unequip(args[0] ?? 'hand');
        break;

      case 'toss': {
        const item = bot.inventory.items().find((i) => i.name === args[0]);
        if (!item) throw new Error(`Item not found: ${args[0]}`);
        await bot.toss(item.type, null, args[1] ?? 1);
        break;
      }

      case 'attack': {
        const entity = findNearestEntity(bot, args[0]);
        if (!entity) throw new Error(`Entity not found: ${args[0]}`);
        bot.attack(entity);
        break;
      }

      case 'follow': {
        const entity = Object.values(bot.entities).find(
          (e) => e.username === args[0]
        );
        if (!entity) throw new Error(`Player not found: ${args[0]}`);
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
        break;
      }

      case 'stopFollowing':
        bot.pathfinder.stop();
        break;

      case 'jump':
        bot.setControlState('jump', true);
        await sleep(100);
        bot.setControlState('jump', false);
        break;

      case 'setControlState':
        bot.setControlState(args[0], args[1]);
        break;

      case 'clearControlStates':
        bot.clearControlStates();
        break;

      case 'lookAt':
        await bot.lookAt(toVec3(args[0]));
        break;

      default:
        return { ok: false, error: `Unhandled action: ${fn}` };
    }

    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { dispatch };
