/**
 * viewer-server.ts
 *
 * Minimal HTTP + WebSocket server that:
 *   - Serves `tools/viewer/index.html` on GET /
 *   - Upgrades WebSocket connections from the same page
 *   - Exposes `broadcast(robotText)` so the runner can push `.robot` content
 *     to every open browser tab in real time
 *
 * Used by `runner.ts` when the `--viewer` flag is set (default: on).
 *
 * Architecture:
 *   - `node:http` handles the HTTP layer
 *   - `ws.WebSocketServer({ server })` attaches to the SAME port (no extra port)
 *   - The HTML page connects via `ws://localhost:<port>` — same origin as the page
 *
 * Graceful shutdown: call `ViewerServer.close()` to stop both HTTP + WS listeners.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildViewerPayload } from './viewer-renderer.js';

// ─── HTML ─────────────────────────────────────────────────────────────────────

/**
 * Load `tools/viewer/index.html` relative to this compiled module.
 *
 * Resolved path at runtime:
 *   dist/recorder/viewer-server.js  →  ../../tools/viewer/index.html
 *
 * Falls back to an inline "no CDN" minimal page if the file cannot be read
 * (e.g., during unit tests or in environments without network access).
 */
function loadViewerHtml(): string {
  try {
    const htmlUrl = new URL('../../tools/viewer/index.html', import.meta.url);
    return readFileSync(fileURLToPath(htmlUrl), 'utf8');
  } catch {
    // Fallback: bare-minimum page so the server never returns an empty body.
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Robot Codegen — Live Preview</title>
<style>body{background:#1a1a2e;color:#a8b2d8;font-family:monospace;padding:24px}</style>
</head><body>
<h1>Robot Codegen — Live Preview</h1>
<pre id="code">Connecting…</pre>
<script>
  var ws=new WebSocket('ws://'+location.host);
  ws.onmessage=function(e){
    var m=JSON.parse(e.data);
    if(m.type==='update') document.getElementById('code').textContent=m.content;
  };
</script></body></html>`;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

// Re-export BadgeInfo so callers can import from viewer-server directly.
export type { BadgeInfo } from './viewer-renderer.js';

/**
 * Commands the viewer page can send to the server.
 * Kept as a small string-union so handlers stay easy to fan out without a
 * full protocol layer.
 */
export type ReplayCommand =
  | { type: 'replay-start' }
  | { type: 'replay-pause' }
  | { type: 'replay-resume' }
  | { type: 'replay-step' }
  | { type: 'replay-stop' };

/** State the server pushes to the viewer page for the replay panel. */
export interface ReplayStateMessage {
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error' | 'stopped';
  currentIndex: number;
  totalActions: number;
  currentName?: string;
  errorMessage?: string;
}

export interface ViewerServer {
  /** Port the HTTP / WebSocket server is listening on. */
  port: number;
  /** Full URL to open in a browser (`http://localhost:<port>`). */
  url: string;
  /** Push the current `.robot` file content to all connected browser clients. */
  broadcast(robotContent: string): void;
  /**
   * Push replay state to all connected viewer clients. Sent every time the
   * replay engine's status changes.
   */
  broadcastReplayState(state: ReplayStateMessage): void;
  /**
   * Register a handler for commands the viewer sends back (Replay/Pause/Step…).
   * Only one handler is supported; calling again replaces the previous one.
   */
  setCommandHandler(handler: (cmd: ReplayCommand) => void | Promise<void>): void;
  /** Shut down both the HTTP and WebSocket servers. */
  close(): void;
}

/**
 * Start the viewer HTTP + WebSocket server.
 *
 * @param preferredPort  TCP port to listen on.  `0` (default) lets the OS
 *                       assign a free ephemeral port — safest for avoiding
 *                       conflicts during concurrent recordings.
 */
export async function startViewerServer(preferredPort = 0): Promise<ViewerServer> {
  const html = loadViewerHtml();

  // ── HTTP server ─────────────────────────────────────────────────────────────
  const httpServer = createServer((req, res) => {
    // All GET requests return the viewer page (single-page app).
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  // ── WebSocket server (attached to the same port) ────────────────────────────
  const wss = new WebSocketServer({ server: httpServer });

  // Command handler — registered by the runner via setCommandHandler().
  let commandHandler: ((cmd: ReplayCommand) => void | Promise<void>) | null = null;
  // Last known replay state, replayed to new connections so a browser tab
  // that opens mid-session sees the current panel state.
  let lastReplayState: ReplayStateMessage | null = null;

  wss.on('connection', (client) => {
    // Send current replay state to the freshly-connected viewer so the
    // replay panel renders without needing the runner to broadcast again.
    if (lastReplayState && client.readyState === 1) {
      client.send(JSON.stringify({ type: 'replay-state', state: lastReplayState }));
    }

    client.on('message', (data) => {
      let parsed: unknown;
      try {
        // `data` is Buffer | ArrayBuffer | Buffer[] — `Buffer.toString('utf8')` is safe.
        // Normalise to Buffer to dodge the `[object Object]` template-string trap.
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');
        parsed = JSON.parse(text);
      } catch {
        return; // ignore malformed frames
      }
      if (!parsed || typeof parsed !== 'object') return;
      const cmd = parsed as { type?: string };
      if (typeof cmd.type !== 'string') return;
      if (cmd.type.startsWith('replay-') && commandHandler) {
        Promise.resolve(commandHandler(cmd as ReplayCommand)).catch(() => {
          /* handler errors are surfaced via replay-state broadcasts */
        });
      }
    });
  });

  // ── Bind to the port ────────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(preferredPort, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const addr = httpServer.address() as { port: number };
  const { port } = addr;

  // ── broadcast helper ────────────────────────────────────────────────────────
  function broadcast(robotContent: string): void {
    // Parse xlib markers and build badge metadata alongside the raw text.
    const payload = buildViewerPayload(robotContent);
    const message = JSON.stringify({
      type: 'update',
      content: payload.text,
      badges: payload.badges,
    });
    for (const client of wss.clients) {
      // readyState 1 === OPEN (matches ws.WebSocket.OPEN constant)
      if (client.readyState === 1) {
        client.send(message, () => {
          /* ignore send errors */
        });
      }
    }
  }

  function broadcastReplayState(state: ReplayStateMessage): void {
    lastReplayState = state;
    const message = JSON.stringify({ type: 'replay-state', state });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(message, () => {
          /* ignore */
        });
      }
    }
  }

  function setCommandHandler(handler: (cmd: ReplayCommand) => void | Promise<void>): void {
    commandHandler = handler;
  }

  // ── close helper ────────────────────────────────────────────────────────────
  function close(): void {
    // Close all WebSocket connections before shutting down the HTTP server.
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    httpServer.close();
  }

  return {
    port,
    url: `http://localhost:${port}`,
    broadcast,
    broadcastReplayState,
    setCommandHandler,
    close,
  };
}
