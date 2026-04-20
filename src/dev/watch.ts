/**
 * File watcher for `pluggy dev`.
 *
 * Watches:
 *   - `<project>/src/` recursively
 *   - every path referenced by `project.resources` (file or directory)
 *   - `project.projectFile` itself (`project.json`)
 *
 * Events are coalesced by `debounceMs` — a burst of saves produces exactly
 * one `onChange` call. Uses `node:fs/promises#watch` (AsyncIterable) rather
 * than `chokidar` to keep the dependency tree small; it's flaky across
 * platforms (especially macOS rename detection) but we accept false-positives
 * over missed events.
 *
 * See docs/SPEC.md §2.11 "Watch and reload".
 */

import { existsSync, statSync } from "node:fs";
import { watch } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { log } from "../logging.ts";
import type { ResolvedProject } from "../project.ts";

export interface WatchOptions {
  /** Debounce interval in milliseconds for file-change events. */
  debounceMs: number;
  /** Called when a rebuild-worthy change is detected (already debounced). */
  onChange: () => Promise<void>;
}

/**
 * Watch the project's source tree and resource paths. Returns a disposer
 * that aborts every watcher and cancels the pending debounce timer.
 */
export function watchProject(project: ResolvedProject, opts: WatchOptions): () => void {
  const controller = new AbortController();

  const targets = collectWatchTargets(project);

  let debounceTimer: NodeJS.Timeout | undefined;
  let disposed = false;

  const fire = (): void => {
    debounceTimer = undefined;
    if (disposed) return;
    Promise.resolve()
      .then(() => opts.onChange())
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`watch: onChange handler threw: ${msg}`);
      });
  };

  const schedule = (): void => {
    if (disposed) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, opts.debounceMs);
    debounceTimer.unref?.();
  };

  for (const target of targets) {
    void consumeWatcher(target, controller.signal, schedule);
  }

  return (): void => {
    if (disposed) return;
    disposed = true;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    controller.abort();
  };
}

/**
 * A `fs.watch` call wants either a directory (recursive) or a file. For the
 * project's resource mappings we normalize each declared path into the parent
 * directory it lives in — watching a file on its own works on every OS, but
 * some editors remove-then-rewrite, which evicts the inode and kills the
 * watcher. Watching the containing dir instead survives atomic writes.
 */
function collectWatchTargets(project: ResolvedProject): string[] {
  const roots = new Set<string>();

  const srcDir = resolve(project.rootDir, "src");
  if (existsSync(srcDir)) roots.add(srcDir);

  roots.add(dirname(project.projectFile));

  const resources = project.resources;
  if (resources !== undefined && resources !== null) {
    for (const value of Object.values(resources)) {
      const absolute = resolve(project.rootDir, value);
      if (!existsSync(absolute)) continue;
      try {
        const info = statSync(absolute);
        roots.add(info.isDirectory() ? absolute : dirname(absolute));
      } catch {
        // Path vanished between existsSync and statSync. Skip.
      }
    }
  }

  return [...roots];
}

async function consumeWatcher(
  target: string,
  signal: AbortSignal,
  onEvent: () => void,
): Promise<void> {
  try {
    const iter = watch(target, { recursive: true, signal });
    for await (const _evt of iter) {
      if (signal.aborted) return;
      onEvent();
    }
  } catch (err: unknown) {
    // AbortError is the expected quit path. Platforms vary on its .name
    // ("AbortError" on Node 20+), so we also accept the explicit flag.
    if (signal.aborted) return;
    const e = err as { name?: string; code?: string };
    if (e.name === "AbortError" || e.code === "ABORT_ERR") return;
    log.debug(`watch: watcher on "${target}" failed: ${(err as Error).message ?? String(err)}`);
  }
}
