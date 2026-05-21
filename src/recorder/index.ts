/**
 * xlibrary/recorder — public barrel for the recording orchestrator.
 *
 *   import { runRecorder } from 'xlibrary/recorder';
 *
 * ⚠ EXPERIMENTAL: API may change in any 0.x release.
 *
 * Internal modules (bundle-patcher, viewer-server, inspector-toolbar, …) are
 * NOT re-exported here. They are implementation details of `runRecorder`.
 */

export { runRecorder } from './runner.js';
export { buildInspectorInjection } from './inspector-toolbar/index.js';

export type { ViewerServer, ReplayCommand, ReplayStateMessage } from './viewer-server.js';
