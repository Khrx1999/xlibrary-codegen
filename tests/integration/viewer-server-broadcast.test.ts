/**
 * Viewer-server broadcast and command round-trip integration tests.
 *
 * These tests verify the HTTP + WebSocket server behavior directly using
 * Node's built-in WebSocket client (ws package), without a full browser.
 * The existing inspector-toolbar.test.ts covers button interactions from
 * a real browser perspective — this file targets:
 *   - HTTP GET returns HTML
 *   - broadcast() delivers update messages to connected clients
 *   - broadcastReplayState() delivers replay-state messages
 *   - Newly-connected clients receive the last replay state (catch-up)
 *   - commandHandler fires on incoming replay-* messages
 *   - close() shuts down cleanly
 *   - Multiple simultaneous clients all receive broadcasts
 *
 * Coverage target: src/recorder/viewer-server.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import http from 'node:http';

import {
  startViewerServer,
  type ViewerServer,
  type ReplayStateMessage,
} from '../../src/recorder/viewer-server.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Open a WebSocket to the server and wait for the connection to open. */
function openWs(server: ViewerServer): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Collect the next N messages from a WebSocket into an array. */
function collectMessages(ws: WebSocket, count: number, timeoutMs = 3000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const msgs: unknown[] = [];
    const timer = setTimeout(() => {
      reject(
        new Error(
          `collectMessages: timed out after ${timeoutMs}ms — received ${msgs.length}/${count}`,
        ),
      );
    }, timeoutMs);

    ws.on('message', (raw) => {
      const text = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : Buffer.from(raw as ArrayBuffer).toString('utf8');
      msgs.push(JSON.parse(text));
      if (msgs.length >= count) {
        clearTimeout(timer);
        resolve(msgs);
      }
    });
  });
}

/** HTTP GET and return body as string. */
function httpGet(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/`, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewerServer — HTTP', () => {
  let server: ViewerServer;

  beforeEach(async () => {
    server = await startViewerServer(0);
  });

  afterEach(() => {
    server.close();
  });

  it('GET / returns 200 HTML response containing DOCTYPE', async () => {
    const body = await httpGet(server.port);
    expect(body.toLowerCase()).toContain('<!doctype html');
  });

  it('GET / response body contains a WebSocket connection script', async () => {
    const body = await httpGet(server.port);
    // The viewer page must establish a WebSocket to receive live updates
    expect(body.toLowerCase()).toContain('websocket');
  });

  it('server listens on a non-zero port', () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it('url field matches http://localhost:<port>', () => {
    expect(server.url).toBe(`http://localhost:${server.port}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewerServer — broadcast()', () => {
  let server: ViewerServer;

  beforeEach(async () => {
    server = await startViewerServer(0);
  });

  afterEach(() => {
    server.close();
  });

  it('sends { type: "update", content: <robotText> } to connected client', async () => {
    const ws = await openWs(server);
    const msgPromise = collectMessages(ws, 1);
    server.broadcast('*** Settings ***\nLibrary    Browser\n');
    const [msg] = await msgPromise;
    ws.close();
    expect((msg as { type: string }).type).toBe('update');
    expect((msg as { content: string }).content).toContain('*** Settings ***');
  });

  it('multiple broadcasts arrive in order', async () => {
    const ws = await openWs(server);
    const msgPromise = collectMessages(ws, 3);
    server.broadcast('content1');
    server.broadcast('content2');
    server.broadcast('content3');
    const msgs = await msgPromise;
    ws.close();
    expect((msgs[0] as { content: string }).content).toBe('content1');
    expect((msgs[1] as { content: string }).content).toBe('content2');
    expect((msgs[2] as { content: string }).content).toBe('content3');
  });

  it('broadcast to multiple simultaneous clients', async () => {
    const ws1 = await openWs(server);
    const ws2 = await openWs(server);
    const p1 = collectMessages(ws1, 1);
    const p2 = collectMessages(ws2, 1);
    server.broadcast('hello all');
    const [m1, m2] = await Promise.all([p1, p2]);
    ws1.close();
    ws2.close();
    expect((m1[0] as { content: string }).content).toBe('hello all');
    expect((m2[0] as { content: string }).content).toBe('hello all');
  });

  it('broadcast when no clients connected does not throw', () => {
    expect(() => server.broadcast('no one listening')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewerServer — broadcastReplayState()', () => {
  let server: ViewerServer;

  beforeEach(async () => {
    server = await startViewerServer(0);
  });

  afterEach(() => {
    server.close();
  });

  it('sends { type: "replay-state", state: <state> } to connected client', async () => {
    const ws = await openWs(server);
    const msgPromise = collectMessages(ws, 1);
    const state: ReplayStateMessage = {
      status: 'running',
      currentIndex: 2,
      totalActions: 5,
      currentName: 'click',
    };
    server.broadcastReplayState(state);
    const [msg] = await msgPromise;
    ws.close();
    expect((msg as { type: string }).type).toBe('replay-state');
    const received = (msg as { state: ReplayStateMessage }).state;
    expect(received.status).toBe('running');
    expect(received.currentIndex).toBe(2);
    expect(received.totalActions).toBe(5);
    expect(received.currentName).toBe('click');
  });

  it('newly-connected client receives the last replay state (catch-up)', async () => {
    const state: ReplayStateMessage = {
      status: 'paused',
      currentIndex: 1,
      totalActions: 3,
    };
    server.broadcastReplayState(state);

    // Attach message listener BEFORE connection opens to avoid race with
    // the server's immediate catch-up send on 'connection' event.
    const msgs: unknown[] = [];
    const msgPromise = new Promise<unknown[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const timer = setTimeout(() => reject(new Error('timeout')), 3000);
      ws.on('message', (raw) => {
        const text = Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : Buffer.from(raw as ArrayBuffer).toString('utf8');
        msgs.push(JSON.parse(text));
        if (msgs.length >= 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msgs);
        }
      });
      ws.once('error', reject);
    });
    const [msg] = await msgPromise;
    expect((msg as { type: string }).type).toBe('replay-state');
    expect((msg as { state: ReplayStateMessage }).state.status).toBe('paused');
  });

  it('last replay state is overwritten by a newer broadcast', async () => {
    server.broadcastReplayState({ status: 'running', currentIndex: 0, totalActions: 3 });
    server.broadcastReplayState({ status: 'complete', currentIndex: 2, totalActions: 3 });

    // Attach message listener BEFORE connection opens to avoid race with
    // the server's immediate catch-up send on 'connection' event.
    const msgs: unknown[] = [];
    const msgPromise = new Promise<unknown[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const timer = setTimeout(() => reject(new Error('timeout')), 3000);
      ws.on('message', (raw) => {
        const text = Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : Buffer.from(raw as ArrayBuffer).toString('utf8');
        msgs.push(JSON.parse(text));
        if (msgs.length >= 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msgs);
        }
      });
      ws.once('error', reject);
    });
    const [msg] = await msgPromise;
    expect((msg as { state: ReplayStateMessage }).state.status).toBe('complete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewerServer — setCommandHandler()', () => {
  let server: ViewerServer;

  beforeEach(async () => {
    server = await startViewerServer(0);
  });

  afterEach(() => {
    server.close();
  });

  it('fires the handler when client sends replay-start', async () => {
    const received: string[] = [];
    server.setCommandHandler((cmd) => {
      received.push(cmd.type);
    });

    const ws = await openWs(server);
    ws.send(JSON.stringify({ type: 'replay-start' }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    expect(received).toContain('replay-start');
  });

  it('fires for all replay-* command types', async () => {
    const received: string[] = [];
    server.setCommandHandler((cmd) => {
      received.push(cmd.type);
    });

    const ws = await openWs(server);
    const commands = [
      'replay-start',
      'replay-pause',
      'replay-resume',
      'replay-step',
      'replay-stop',
    ];
    for (const type of commands) {
      ws.send(JSON.stringify({ type }));
    }
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
    for (const type of commands) {
      expect(received).toContain(type);
    }
  });

  it('ignores messages that are not replay-* commands', async () => {
    const received: string[] = [];
    server.setCommandHandler((cmd) => {
      received.push(cmd.type);
    });

    const ws = await openWs(server);
    ws.send(JSON.stringify({ type: 'update', content: 'hello' })); // not replay-
    ws.send(JSON.stringify({ type: 'custom-event' })); // not replay-
    ws.send(JSON.stringify({ type: 'replay-start' })); // this one fires
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    expect(received).toEqual(['replay-start']);
  });

  it('ignores malformed (non-JSON) messages gracefully', async () => {
    const received: string[] = [];
    server.setCommandHandler((cmd) => {
      received.push(cmd.type);
    });

    const ws = await openWs(server);
    ws.send('NOT JSON AT ALL');
    ws.send(JSON.stringify({ type: 'replay-start' }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    // Only valid replay-start should fire
    expect(received).toEqual(['replay-start']);
  });

  it('replacing the handler with a new one takes effect immediately', async () => {
    const firstReceived: string[] = [];
    const secondReceived: string[] = [];

    server.setCommandHandler((cmd) => {
      firstReceived.push(cmd.type);
    });
    server.setCommandHandler((cmd) => {
      secondReceived.push(cmd.type);
    });

    const ws = await openWs(server);
    ws.send(JSON.stringify({ type: 'replay-stop' }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    expect(firstReceived).toHaveLength(0);
    expect(secondReceived).toContain('replay-stop');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewerServer — close()', () => {
  it('shuts down without error', async () => {
    const server = await startViewerServer(0);
    expect(() => server.close()).not.toThrow();
  });

  it('closed server stops accepting new connections', async () => {
    const server = await startViewerServer(0);
    const port = server.port;
    server.close();
    // Give the OS time to release the port
    await new Promise((r) => setTimeout(r, 100));
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.once('open', () => resolve('connected'));
        ws.once('error', reject);
      }),
    ).rejects.toBeDefined();
  });
});
