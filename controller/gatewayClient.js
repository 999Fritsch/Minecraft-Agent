'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const RECONNECT_DELAY_MS = 3000;

/**
 * Create a persistent WebSocket client to the OpenClaw gateway.
 * Returns { send, inject, abort } methods for pushing events to the agent.
 */
function createGatewayClient() {
  let ws = null;
  let connected = false;
  let reconnecting = false;

  function connect() {
    reconnecting = false;
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => {
      connected = true;
      console.log('[gateway] Connected to OpenClaw gateway');
      ws.send(JSON.stringify({
        type: 'req',
        id: '1',
        method: 'connect',
        params: {
          auth: { token: process.env.OPENCLAW_TOKEN ?? '' },
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'node-host',
            platform: 'linux',
            mode: 'node',
            version: '1.0.0',
          },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          console.warn('[gateway] Gateway error response:', msg.error);
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      connected = false;
      console.log('[gateway] Disconnected, reconnecting in', RECONNECT_DELAY_MS, 'ms');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      connected = false;
      console.error('[gateway] WebSocket error:', err.message);
    });
  }

  function scheduleReconnect() {
    if (reconnecting) return;
    reconnecting = true;
    setTimeout(connect, RECONNECT_DELAY_MS);
  }

  function safeSend(payload) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[gateway] Not connected — dropping event:', payload.method);
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  function send(eventObj) {
    safeSend({
      type: 'req',
      id: crypto.randomUUID(),
      method: 'chat.send',
      params: { text: `[MC_EVENT] ${JSON.stringify(eventObj)}` },
    });
  }

  function inject(eventObj) {
    safeSend({
      type: 'req',
      id: crypto.randomUUID(),
      method: 'chat.inject',
      params: { text: `[MC_EVENT] ${JSON.stringify(eventObj)}` },
    });
  }

  function abort() {
    safeSend({
      type: 'req',
      id: crypto.randomUUID(),
      method: 'chat.abort',
      params: { sessionKey: process.env.OPENCLAW_SESSION_KEY ?? 'main' },
    });
  }

  connect();

  return { send, inject, abort };
}

module.exports = { createGatewayClient };
