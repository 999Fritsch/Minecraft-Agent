'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');
const { exec } = require('child_process');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const RECONNECT_DELAY_MS = 3000;

/**
 * Create a persistent receive-only WebSocket connection to the OpenClaw gateway.
 * write methods (chat.send/inject/abort) are intentionally absent — the
 * mc-agent connection lacks operator.write scope. Event delivery is handled
 * via the MCP server's get_events tool instead.
 *
 * Kept for: receiving heartbeat ticks, presence events, and node.invoke.request
 * (exec commands routed by the agent, if scope is fixed in the future).
 */
function createGatewayClient() {
  let ws = null;
  let connected = false;
  let reconnecting = false;

  function handleNodeInvoke(payload) {
    const { invokeId, command, workdir } = payload ?? {};
    if (!invokeId || !command) return;

    // Resolve env-style placeholders the agent may emit (e.g. <MC_CONTROLLER_TOKEN>)
    const resolved = command.replace(/<([A-Z0-9_]+)>/g, (_, key) => process.env[key] ?? '');
    console.log('[gateway] node.invoke:', resolved.slice(0, 120));

    exec(resolved, { cwd: workdir ?? '/tmp', timeout: 30000 }, (err, stdout, stderr) => {
      safeSend({
        type: 'req',
        id: crypto.randomUUID(),
        method: 'node.invoke.result',
        params: {
          invokeId,
          exitCode: err ? (err.code ?? 1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        },
      });
    });
  }

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
        if (msg.event === 'node.invoke.request') {
          handleNodeInvoke(msg.payload);
        }
      } catch (_) {}
    });

    ws.on('close', (code, reason) => {
      connected = false;
      console.log('[gateway] Disconnected (code=%d reason=%s), reconnecting in %d ms', code, reason, RECONNECT_DELAY_MS);
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
      console.warn('[gateway] Not connected — dropping:', payload.method);
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  connect();
}

module.exports = { createGatewayClient };
