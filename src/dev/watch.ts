/**
 * File watcher for `pluggy dev`. Watches `src/`, every path referenced by
 * `project.resources`, and `project.json`. Events are coalesced by
 * `debounceMs` — a burst of saves yields one `onChange`. See §2.11.
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
 * Collect directory paths to watch. Resource-file mappings are normalized to
 * their parent directory — atomic-rewrite editors evict the file's inode,
 * which kills a file-level watcher; watching the dir survives.
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
        // Path vanished between existsSync and statSync.
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
    // AbortError is the expected quit path; platforms vary on `.name`.
    if (signal.aborted) return;
    const e = err as { name?: string; code?: string };
    if (e.name === "AbortError" || e.code === "ABORT_ERR") return;
    log.debug(`watch: watcher on "${target}" failed: ${(err as Error).message ?? String(err)}`);
  }
}
