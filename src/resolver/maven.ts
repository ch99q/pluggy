/**
 * Maven resolver.
 *
 * Walks `ctx.registries` in order, tries to fetch the standard Maven path
 * `<registry>/<group/with/slashes>/<artifact>/<version>/<artifact>-<version>.jar`.
 * First 200 wins. If none respond 200, throws with the full registry list tried.
 *
 * See docs/SPEC.md §2.4 and §1.5.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getCachePath } from "../project.ts";
import type { ResolvedSource } from "../source.ts";

import type { ResolveContext, ResolvedDependency } from "./index.ts";

export async function resolveMaven(
  groupId: string,
  artifactId: string,
  version: string,
  ctx: ResolveContext,
): Promise<ResolvedDependency> {
  const coord = `${groupId}:${artifactId}:${version}`;

  if (!Array.isArray(ctx.registries) || ctx.registries.length === 0) {
    throw new Error(
      `Maven: no registries configured for "${coord}". Declare a Maven registry in project.json:registries.`,
    );
  }

  const cacheDir = join(getCachePath(), "dependencies", "maven", groupId, artifactId);
  await mkdir(cacheDir, { recursive: true });
  const jarPath = join(cacheDir, `${version}.jar`);

  const artifactPath = buildArtifactPath(groupId, artifactId, version);
  const errors: string[] = [];

  for (const registry of ctx.registries) {
    const url = joinRegistryUrl(registry, artifactPath);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      errors.push(`${url} -> network error: ${(err as Error).message}`);
      continue;
    }
    if (!res.ok) {
      errors.push(`${url} -> ${res.status} ${res.statusText}`);
      continue;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(jarPath, bytes);
    const integrity = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

    const source: ResolvedSource = { kind: "maven", groupId, artifactId, version };
    return {
      source,
      jarPath,
      integrity,
      transitiveDeps: [],
    };
  }

  throw new Error(
    `Maven: could not resolve "${coord}" from any configured registry. Tried:\n  ${errors.join("\n  ")}`,
  );
}

function buildArtifactPath(groupId: string, artifactId: string, version: string): string {
  const groupPath = groupId.replace(/\./g, "/");
  return `${groupPath}/${artifactId}/${version}/${artifactId}-${version}.jar`;
}

function joinRegistryUrl(registry: string, artifactPath: string): string {
  const base = registry.endsWith("/") ? registry.slice(0, -1) : registry;
  return `${base}/${artifactPath}`;
}
