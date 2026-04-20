import type { ResolvedProject } from "../project.ts";

export interface WatchOptions {
  /** Debounce interval in milliseconds for file-change events. */
  debounceMs: number;
  /** Called when a rebuild-worthy change is detected (already debounced). */
  onChange: () => Promise<void>;
}

/**
 * Watch `project.rootDir/src/**`, any paths referenced by `project.resources`,
 * and `project.projectFile` itself. Returns a disposer to stop watching.
 */
export function watchProject(_project: ResolvedProject, _opts: WatchOptions): () => void {
  throw new Error("not implemented: watchProject");
}
