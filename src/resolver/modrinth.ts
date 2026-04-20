/**
 * Modrinth resolver. Fetches the version list for a slug, picks a concrete
 * version (honouring `includePrerelease`), and downloads the primary jar
 * into the user cache.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { getCachePath } from "../project.ts";
import type { ResolvedSource } from "../source.ts";

import type { ResolveContext, ResolvedDependency } from "./index.ts";

const MODRINTH_API = "https://api.modrinth.com/v2";
const LATEST_STABLE = "*";

interface ModrinthFile {
  url: string;
  filename: string;
  primary: boolean;
  hashes: { sha1?: string; sha512?: string };
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  files: ModrinthFile[];
}

/**
 * Resolve `modrinth:<slug>@<version>` into a cached jar. `version === "*"`
 * picks the newest (stable unless `ctx.includePrerelease`).
 */
export async function resolveModrinth(
  slug: string,
  version: string,
  ctx: ResolveContext,
): Promise<ResolvedDependency> {
  const versions = await fetchVersions(slug);
  const picked = pickVersion(slug, version, versions, ctx.includePrerelease);
  const file = pickPrimaryFile(slug, picked);

  const cacheDir = join(getCachePath(), "dependencies", "modrinth", slug);
  await mkdir(cacheDir, { recursive: true });
  const jarPath = join(cacheDir, `${picked.version_number}.jar`);

  if (!(await fileExists(jarPath))) {
    await downloadTo(file.url, jarPath, slug, picked.version_number);
  }

  const integrity = await sha256OfFile(jarPath);

  const source: ResolvedSource = {
    kind: "modrinth",
    slug,
    version: picked.version_number,
  };

  return {
    source,
    jarPath,
    integrity,
    transitiveDeps: [],
  };
}

async function fetchVersions(slug: string): Promise<ModrinthVersion[]> {
  const url = `${MODRINTH_API}/project/${encodeURIComponent(slug)}/version`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Modrinth API request failed for slug "${slug}": ${res.status} ${res.statusText} (${url})`,
    );
  }
  const data = (await res.json()) as ModrinthVersion[];
  if (!Array.isArray(data)) {
    throw new Error(`Modrinth API returned non-array response for slug "${slug}" at ${url}`);
  }
  return data;
}

function pickVersion(
  slug: string,
  version: string,
  versions: ModrinthVersion[],
  includePrerelease: boolean,
): ModrinthVersion {
  if (versions.length === 0) {
    throw new Error(`Modrinth: no versions published for slug "${slug}"`);
  }

  if (version === LATEST_STABLE) {
    const eligible = includePrerelease
      ? versions
      : versions.filter((v) => v.version_type === "release");
    if (eligible.length === 0) {
      throw new Error(
        `Modrinth: no ${includePrerelease ? "" : "stable "}versions available for slug "${slug}"` +
          (includePrerelease ? "" : " (pass --beta to include pre-releases)"),
      );
    }
    // Modrinth orders versions newest-first; no re-sort needed.
    return eligible[0];
  }

  const hit = versions.find((v) => v.version_number === version);
  if (hit === undefined) {
    const sample = versions
      .slice(0, 3)
      .map((v) => v.version_number)
      .join(", ");
    throw new Error(
      `Modrinth: version "${version}" not found for slug "${slug}". available: ${sample}${
        versions.length > 3 ? ", ..." : ""
      }`,
    );
  }
  if (!includePrerelease && hit.version_type !== "release") {
    throw new Error(
      `Modrinth: version "${version}" of "${slug}" is a ${hit.version_type} release; pass --beta to install pre-releases`,
    );
  }
  return hit;
}

function pickPrimaryFile(slug: string, version: ModrinthVersion): ModrinthFile {
  if (version.files.length === 0) {
    throw new Error(
      `Modrinth: version "${version.version_number}" of "${slug}" has no downloadable files`,
    );
  }
  const primary = version.files.find((f) => f.primary);
  return primary ?? version.files[0];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(
  url: string,
  destination: string,
  slug: string,
  versionNumber: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Modrinth: failed to download "${slug}" version "${versionNumber}" from ${url}: ${res.status} ${res.statusText}`,
    );
  }
  if (res.body === null) {
    throw new Error(
      `Modrinth: empty response body downloading "${slug}" version "${versionNumber}" from ${url}`,
    );
  }
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(destination));
}

async function sha256OfFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `sha256-${hash}`;
}
