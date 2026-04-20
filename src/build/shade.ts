/**
 * Shading — selectively copy classes/resources from dependency jars into the
 * staging directory per the project's `shading` rules.
 *
 * A dep without a rule is NOT shaded (§1.6). For deps with a rule, each
 * entry in the jar is matched against the include globs; an entry that
 * matches at least one include AND no exclude is copied into the staging
 * directory at the same relative path.
 *
 * Uses `yauzl` for streaming zip reads.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import { log } from "../logging.ts";
import type { Shading } from "../project.ts";
import type { ResolvedDependency } from "../resolver/index.ts";
import { PENDING_BUILD_INTEGRITY } from "../resolver/workspace.ts";

/**
 * Look up the dependency name as declared in `project.json:dependencies`.
 * The shading map is keyed by these names, which are:
 *   - the `source.slug` for modrinth
 *   - the `source.artifactId` for maven
 *   - basename-without-`.jar` for file
 *   - `source.name` for workspace
 */
function depName(dep: ResolvedDependency): string {
  switch (dep.source.kind) {
    case "modrinth":
      return dep.source.slug;
    case "maven":
      return dep.source.artifactId;
    case "file": {
      const p = dep.source.path.replace(/\\/g, "/");
      const base = p.slice(p.lastIndexOf("/") + 1);
      return base.toLowerCase().endsWith(".jar") ? base.slice(0, -4) : base;
    }
    case "workspace":
      return dep.source.name;
  }
}

export async function applyShading(
  deps: ResolvedDependency[],
  rules: Record<string, Shading>,
  stagingDir: string,
): Promise<void> {
  for (const dep of deps) {
    const name = depName(dep);
    const rule = rules[name];
    if (rule === undefined) continue; // not shaded → skip (default)

    if (dep.integrity === PENDING_BUILD_INTEGRITY) {
      if (!existsSync(dep.jarPath)) {
        throw new Error(
          `shade: workspace dependency "${name}" has not been built yet — expected jar at "${dep.jarPath}". Build the sibling workspace first (topological order is the caller's responsibility).`,
        );
      }
    }

    if (!existsSync(dep.jarPath)) {
      throw new Error(
        `shade: dependency "${name}" jar not found at "${dep.jarPath}" — resolve it first`,
      );
    }

    await shadeDependency(name, dep.jarPath, rule, stagingDir);
  }
}

async function shadeDependency(
  name: string,
  jarPath: string,
  rule: Shading,
  stagingDir: string,
): Promise<void> {
  const includes = rule.include ?? ["**"];
  const excludes = rule.exclude ?? [];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    // autoClose: false so we can extract selected entries after the `end`
    // event; with the default (true), yauzl closes the file descriptor as
    // soon as `end` fires, which races with any openReadStream we queue.
    yauzl.open(jarPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err !== null || zip === undefined) {
        rejectPromise(
          new Error(
            `shade: failed to open jar for "${name}" at "${jarPath}": ${err?.message ?? "unknown error"}`,
          ),
        );
        return;
      }

      const extractQueue: Entry[] = [];
      let errored = false;

      const onEnd = async (): Promise<void> => {
        try {
          for (const entry of extractQueue) {
            await extractEntry(zip, entry, stagingDir, name);
          }
          resolvePromise();
        } catch (e) {
          rejectPromise(e as Error);
        } finally {
          zip.close();
        }
      };

      zip.on("entry", (entry: Entry) => {
        if (errored) return;
        // Directories end with "/" in zip entry names. Skip them; we only
        // copy regular files, and the destination directories are created
        // at write time.
        if (entry.fileName.endsWith("/")) {
          zip.readEntry();
          return;
        }
        if (matches(entry.fileName, includes) && !matches(entry.fileName, excludes)) {
          extractQueue.push(entry);
        }
        zip.readEntry();
      });

      zip.once("end", () => {
        void onEnd();
      });

      zip.once("error", (e: Error) => {
        errored = true;
        rejectPromise(
          new Error(`shade: error reading jar for "${name}" at "${jarPath}": ${e.message}`),
        );
      });

      zip.readEntry();
    });
  });
}

function extractEntry(
  zip: ZipFile,
  entry: Entry,
  stagingDir: string,
  depName: string,
): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, async (err, stream) => {
      if (err !== null || stream === undefined) {
        rejectPromise(
          new Error(
            `shade: failed to read entry "${entry.fileName}" from "${depName}": ${err?.message ?? "unknown error"}`,
          ),
        );
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.once("end", async () => {
        try {
          const data = Buffer.concat(chunks);
          const dest = join(stagingDir, entry.fileName);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, data);
          log.debug(`shade: ${depName} -> ${entry.fileName} (${data.length}b)`);
          resolvePromise();
        } catch (e) {
          rejectPromise(e as Error);
        }
      });
      stream.once("error", (e: Error) => {
        rejectPromise(
          new Error(`shade: stream error on "${entry.fileName}" from "${depName}": ${e.message}`),
        );
      });
    });
  });
}

/**
 * Return true iff `path` matches any of the `patterns`.
 *
 * Pattern syntax:
 *   - `*`  matches any sequence of characters within a single path segment
 *   - `**` matches any depth, including zero segments
 *   - all other characters match literally
 *
 * Path separators are always `/` (zip entry names use forward slashes).
 * Patterns are rooted at the entry-name root — a leading `/` on either side
 * is normalized away.
 */
export function matches(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalizedPath = posix.normalize(path).replace(/^\/+/, "");
  for (const raw of patterns) {
    const pattern = raw.replace(/^\/+/, "");
    if (matchGlob(normalizedPath, pattern)) return true;
  }
  return false;
}

function matchGlob(path: string, pattern: string): boolean {
  // Convert glob to a regex. Process `**` first so it doesn't collide with `*`.
  // Tokens:
  //   `**/` -> "(?:.*?/)?"   (zero or more path segments)
  //   `/**` at end -> "(?:/.*)?"
  //   `**` alone -> ".*"
  //   `*` -> "[^/]*"
  //   `?` -> "[^/]"
  //   everything else -> escaped literal
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // Handle `**` constructs.
      if (pattern[i + 2] === "/") {
        re += "(?:.*?/)?";
        i += 3;
        continue;
      }
      // `**` at end (or in the middle without the following slash)
      re += ".*";
      i += 2;
      continue;
    }
    if (ch === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    // Escape regex metacharacters.
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
    i += 1;
  }
  const regex = new RegExp(`^${re}$`);
  return regex.test(path);
}
