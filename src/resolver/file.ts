/**
 * Local-file resolver.
 *
 * Resolves `file:<path>` sources. The path is interpreted relative to
 * `ctx.rootDir` (see docs/SPEC.md §3.8 — config-relative path resolution).
 * The jar is content-addressed: SHA-256 of the bytes becomes both the cache
 * key and the integrity hash, so two sources pointing at byte-identical jars
 * share a cache entry.
 *
 * See docs/SPEC.md §2.4.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { linkOrCopy } from "../portable.ts";
import { getCachePath } from "../project.ts";
import type { ResolvedSource } from "../source.ts";

import type { ResolveContext, ResolvedDependency } from "./index.ts";

export async function resolveFile(
  path: string,
  version: string,
  ctx: ResolveContext,
): Promise<ResolvedDependency> {
  const normalized = path.replace(/\\/g, "/");
  const absSource = isAbsolute(normalized) ? resolve(normalized) : resolve(ctx.rootDir, normalized);

  try {
    await access(absSource);
  } catch (err) {
    throw new Error(
      `file source not found or unreadable: "${path}" (resolved to "${absSource}"): ${
        (err as Error).message
      }`,
    );
  }

  const bytes = await readFile(absSource);
  const hex = createHash("sha256").update(bytes).digest("hex");
  const integrity = `sha256-${hex}`;

  const cacheDir = join(getCachePath(), "dependencies", "file");
  await mkdir(cacheDir, { recursive: true });
  const jarPath = join(cacheDir, `${hex}.jar`);

  // Hardlink/copy so the cache entry exists even if the source moves.
  // `linkOrCopy` overwrites an existing destination (same hex == same bytes,
  // so this is a cheap refresh, not a correctness hazard).
  await linkOrCopy(absSource, jarPath);

  const source: ResolvedSource = { kind: "file", path: normalized, version };

  return {
    source,
    jarPath,
    integrity,
    transitiveDeps: [],
  };
}
