/**
 * Platform-aware non-blocking helpers for opening files and URLs.
 *
 * `openInEditor` is used by the `--open` flag: after recording ends, the
 * generated `.robot` file is opened in VS Code if available, otherwise the
 * OS default editor (`open` / `xdg-open` / `start`).
 *
 * `openInBrowser` is used by `--open-viewer`: launches the user's default
 * browser at the viewer-server URL.
 *
 * All spawned processes are detached + unref'd so they outlive the CLI exit.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Open `filePath` in the user's preferred editor, non-blocking.
 *
 * Priority:
 *   1. VS Code (`code` on PATH)
 *   2. OS default: `open` (macOS), `xdg-open` (Linux), `start` (Windows)
 *
 * The spawned process is detached + unref'd so it outlives the CLI exit.
 */
export function openInEditor(filePath: string): void {
  const os = platform();

  const vscode = spawn('code', [filePath], {
    stdio: 'ignore',
    detached: true,
  });
  vscode.unref();

  vscode.on('error', () => {
    // VS Code not found — fall back to OS default viewer/editor.
    const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'start' : 'xdg-open';
    const child = spawn(cmd, [filePath], {
      stdio: 'ignore',
      detached: true,
      shell: os === 'win32', // 'start' is a shell built-in on Windows
    });
    child.unref();
  });
}

/**
 * Open a URL in the OS default browser (not VS Code).
 * Detached + unref'd so it outlives the CLI exit.
 */
export function openInBrowser(url: string): void {
  const os = platform();
  const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(cmd, [url], {
    stdio: 'ignore',
    detached: true,
    shell: os === 'win32',
  });
  child.unref();
}
