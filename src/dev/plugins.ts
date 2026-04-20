/**
 * Runtime plugin detection + `dev/plugins/` population.
 *
 * A dependency is a *runtime plugin* iff its jar contains the primary
 * platform's descriptor file (e.g. `plugin.yml`). Compile-time libraries
 * are excluded from `dev/plugins/` but remain on the build classpath.
 * See docs/SPEC.md §2.11.
 */

import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import yauzl from "yauzl";

import type { DescriptorSpec } from "../platform/platform.ts";
import { linkOrCopy } from "../portable.ts";
import type { ResolvedDependency } from "../resolver/index.ts";

/**
 * Return true iff the jar at `jarPath` contains an entry whose name equals
 * `descriptor.path`. Read-only — nothing is extracted.
 */
export function isRuntimePlugin(jarPath: string, descriptor: DescriptorSpec): Promise<boolean> {
  return new Promise<boolean>((resolvePromise, rejectPromise) => {
    yauzl.open(jarPath, { lazyEntries: true }, (err, zip) => {
      if (err !== null || zip === undefined) {
        rejectPromise(
          new Error(
            `isRuntimePlugin: failed to open "${jarPath}": ${err?.message ?? "unknown error"}`,
          ),
        );
        return;
      }

      let found = false;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName === descriptor.path) {
          found = true;
          zip.close();
          resolvePromise(true);
          return;
        }
        zip.readEntry();
      });

      zip.once("end", () => {
        if (!found) resolvePromise(false);
      });

      zip.once("error", (e: Error) => {
        rejectPromise(new Error(`isRuntimePlugin: error reading "${jarPath}": ${e.message}`));
      });

      zip.readEntry();
    });
  });
}

/**
 * Populate `<devDir>/plugins/` with the user's plugin jar, every
 * runtime-plugin dependency, and the `extraPlugins` jars.
 *
 * All paths are linked (hardlink with copy fallback, per §3.8). Destination
 * basenames come from each source's basename — callers must ensure unique
 * names (the build pipeline already scopes its output by name+version).
 */
export async function stagePlugins(
  devDir: string,
  ownJarPath: string,
  runtimeDeps: ResolvedDependency[],
  extraPlugins: string[],
): Promise<void> {
  const pluginsDir = join(devDir, "plugins");
  await mkdir(pluginsDir, { recursive: true });

  await linkOrCopy(ownJarPath, join(pluginsDir, basename(ownJarPath)));

  for (const dep of runtimeDeps) {
    await linkOrCopy(dep.jarPath, join(pluginsDir, basename(dep.jarPath)));
  }

  for (const extra of extraPlugins) {
    await linkOrCopy(extra, join(pluginsDir, basename(extra)));
  }
}
