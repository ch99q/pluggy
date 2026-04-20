/**
 * Dev-server runtime — stage `dev/`, build, spawn server, watch sources.
 *
 * See docs/SPEC.md §2.11 for the full flow.
 */

import type { ResolvedProject } from "../project.ts";

export interface DevOptions {
  platform?: string;
  version?: string;
  port?: number;
  memory?: string;
  clean?: boolean;
  freshWorld?: boolean;
  watch?: boolean;
  reload?: boolean;
  offline?: boolean;
  args?: string[];
}

/**
 * Run the dev loop against the given project. Returns when the server has
 * exited cleanly (e.g. user Ctrl+C → /stop → clean shutdown).
 */
export function runDev(_project: ResolvedProject, _opts: DevOptions): Promise<void> {
  throw new Error("not implemented: runDev");
}
