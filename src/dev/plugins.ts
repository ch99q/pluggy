import type { DescriptorSpec } from "../platform/platform.ts";
import type { ResolvedDependency } from "../resolver/index.ts";

/**
 * Peek a jar's manifest and central directory to detect whether it contains
 * the given platform's descriptor file (e.g. `plugin.yml`). A runtime plugin
 * has one; a compile-time library does not.
 *
 * Used by `runDev` to decide which deps go into `dev/plugins/` and which
 * stay out of the runtime (but still on the build classpath).
 */
export function isRuntimePlugin(_jarPath: string, _descriptor: DescriptorSpec): Promise<boolean> {
  throw new Error("not implemented: isRuntimePlugin");
}

/**
 * Populate `<devDir>/plugins/` with the user's plugin jar, every
 * runtime-plugin dependency, and `project.dev.extraPlugins` entries.
 */
export function stagePlugins(
  _devDir: string,
  _ownJarPath: string,
  _runtimeDeps: ResolvedDependency[],
  _extraPlugins: string[],
): Promise<void> {
  throw new Error("not implemented: stagePlugins");
}
