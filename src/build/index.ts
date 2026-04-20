/**
 * Build pipeline — compile → resources → descriptor → shade → jar.
 *
 * See docs/SPEC.md §2.9 for the full pipeline description.
 */

import type { ResolvedProject } from "../project.ts";

export interface BuildOptions {
  /** Output jar path. Default: `./bin/<name>-<version>.jar` in the workspace. */
  output?: string;
  /** Wipe build cache before building. */
  clean?: boolean;
  /** Skip `.classpath` regeneration. */
  skipClasspath?: boolean;
}

export interface BuildResult {
  outputPath: string;
  sizeBytes: number;
  durationMs: number;
}

export function buildProject(_project: ResolvedProject, _opts: BuildOptions): Promise<BuildResult> {
  throw new Error("not implemented: buildProject");
}
