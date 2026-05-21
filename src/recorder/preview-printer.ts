/**
 * Unicode-box console preview for newly-generated Robot Framework keywords.
 *
 * As the recorder captures new actions, the runner emits the corresponding
 * keyword lines through here so the developer sees a live feed in their
 * terminal without having to peek at the on-disk `.robot` file:
 *
 *   ┌─ Generated keyword ────────────────────────────────────────
 *   │     New Page    https://example.com
 *   │     Click    role=button[name="Sign in"]
 *   └────────────────────────────────────────────────────────────
 *
 * Callers can suppress the preview with `--quiet` — this module is only
 * imported by runner.ts when the flag is off.
 */

const PREVIEW_BOX_WIDTH = 62;
const PREVIEW_TITLE = '─ Generated keyword ';

const PREVIEW_TOP =
  `┌${PREVIEW_TITLE}` + '─'.repeat(Math.max(0, PREVIEW_BOX_WIDTH - 1 - PREVIEW_TITLE.length));

const PREVIEW_BOT = `└${'─'.repeat(PREVIEW_BOX_WIDTH - 1)}`;

/**
 * Print the given keyword lines inside a Unicode box to stdout.
 *
 * Empty input is a no-op — saves the caller from `if (lines.length) …` boilerplate.
 */
export function printKeywordPreview(newLines: string[]): void {
  if (newLines.length === 0) return;
  process.stdout.write(PREVIEW_TOP + '\n');
  for (const line of newLines) {
    process.stdout.write(`│ ${line}\n`);
  }
  process.stdout.write(PREVIEW_BOT + '\n');
}
