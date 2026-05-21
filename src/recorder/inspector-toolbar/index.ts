/**
 * Inspector toolbar HTML injection.
 *
 * `bundle-patcher.ts` splices the string returned by `buildInspectorInjection()`
 * before `</body>` of every HTML file the Playwright Inspector serves. The
 * result is a fixed bottom toolbar with five replay-control buttons
 * (Replay / Pause / Resume / Step / Stop), a progress counter, a status pill,
 * and a "Viewer" external-link button.
 *
 * The HTML is split across three sibling modules to keep concerns separated:
 *   - `styles.ts`        — CSS string
 *   - `icons.ts`         — Lucide-style SVG constants
 *   - `client-script.ts` — Inspector-side JS (runs inside the recorder window)
 *
 * Element IDs referenced by tests/inspector-toolbar.test.ts:
 *   `xlib-bar`, `xlib-replay`, `xlib-pause`, `xlib-resume`, `xlib-step`,
 *   `xlib-stop`, `xlib-progress`, `xlib-badge`, `xlib-open-viewer`.
 *
 * The badge's `.textContent` stays the bare status word (e.g. `idle`, `running`)
 * so existing assertion matchers continue to match.
 */

import { STYLES } from './styles.js';
import {
  ICON_PLAY,
  ICON_PAUSE,
  ICON_STEP,
  ICON_STOP,
  ICON_REPLAY,
  ICON_EXTERNAL,
} from './icons.js';
import { buildClientScript } from './client-script.js';

/**
 * Build the HTML snippet that bundle-patcher splices before `</body>` of the
 * Playwright Inspector window.
 */
export function buildInspectorInjection(viewerUrl: string): string {
  return `
${STYLES}
<div id="xlib-bar" role="toolbar" aria-label="xlibrary replay controls">
  <button class="xlib-btn primary" id="xlib-replay" type="button" title="Replay recorded actions in a new browser">
    ${ICON_REPLAY}<span>Replay</span>
  </button>
  <button class="xlib-btn" id="xlib-pause" type="button" title="Pause replay" disabled>
    ${ICON_PAUSE}<span>Pause</span>
  </button>
  <button class="xlib-btn" id="xlib-resume" type="button" title="Resume from paused" disabled>
    ${ICON_PLAY}<span>Resume</span>
  </button>
  <button class="xlib-btn" id="xlib-step" type="button" title="Step one action" disabled>
    ${ICON_STEP}<span>Step</span>
  </button>
  <button class="xlib-btn danger" id="xlib-stop" type="button" title="Stop replay" disabled>
    ${ICON_STOP}<span>Stop</span>
  </button>
  <span id="xlib-progress"></span>
  <span id="xlib-badge" class="offline">offline</span>
  <button class="xlib-btn ghost" id="xlib-open-viewer" type="button" title="Open the full Live Preview in a new tab">
    ${ICON_EXTERNAL}<span>Viewer</span>
  </button>
</div>
${buildClientScript(viewerUrl)}
`;
}
