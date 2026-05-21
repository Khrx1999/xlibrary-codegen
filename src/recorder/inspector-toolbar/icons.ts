/**
 * Inline Lucide-style SVG icons for the Inspector toolbar.
 *
 * All icons are 14×14, stroke-based, `currentColor` for theming. Kept inline
 * (no <img>, no external CDN) so the Inspector window has no extra network
 * dependency.
 *
 * Source attribution: lucide.dev (MIT licensed).
 */

const SVG_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">`;
const SVG_CLOSE = `</svg>`;

export const ICON_PLAY = `${SVG_OPEN}<polygon points="6 3 20 12 6 21 6 3"/>${SVG_CLOSE}`;

export const ICON_PAUSE = `${SVG_OPEN}<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>${SVG_CLOSE}`;

export const ICON_STEP = `${SVG_OPEN}<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>${SVG_CLOSE}`;

export const ICON_STOP = `${SVG_OPEN}<rect width="14" height="14" x="5" y="5" rx="2"/>${SVG_CLOSE}`;

export const ICON_REPLAY = `${SVG_OPEN}<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>${SVG_CLOSE}`;

export const ICON_EXTERNAL = `${SVG_OPEN}<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>${SVG_CLOSE}`;
