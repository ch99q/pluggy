/**
 * Source-string parser.
 *
 * Converts the strings found in:
 *   - `project.json:dependencies[...].source` (the long-form grammar)
 *   - `pluggy install <identifier>` (the CLI identifier grammar)
 * into a tagged union consumed by the resolver.
 *
 * See docs/SPEC.md §6 for the full grammar.
 */

export type ResolvedSource =
  | { kind: "modrinth"; slug: string; version: string }
  | { kind: "maven"; groupId: string; artifactId: string; version: string }
  | { kind: "file"; path: string; version: string }
  | { kind: "workspace"; name: string; version: string };

const SLUG_RE = /^[a-z0-9][a-z0-9\-_]*$/;
const MAVEN_COORD_RE = /^[a-zA-Z][\w.-]*$/;
const LATEST_STABLE = "*";

/**
 * Parse a `project.json` source string + its declared version into a ResolvedSource.
 *
 * Accepts:
 *   - `"modrinth:<slug>"`
 *   - `"maven:<groupId>:<artifactId>"`
 *   - `"file:<path>"`
 *   - `"workspace:<name>"`
 *
 * Throws on malformed input.
 */
export function parseSource(source: string, version: string): ResolvedSource {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(`Invalid source: "${source}" — expected a non-empty string`);
  }
  if (source !== source.trim() || /\s/.test(source)) {
    throw new Error(`Invalid source: "${source}" — must not contain whitespace`);
  }

  const colonIndex = source.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid source: "${source}" — expected one of "modrinth:", "maven:", "file:", "workspace:"`,
    );
  }

  const scheme = source.slice(0, colonIndex);
  const rest = source.slice(colonIndex + 1);

  switch (scheme) {
    case "modrinth": {
      if (!SLUG_RE.test(rest)) {
        throw new Error(
          `Invalid source: "${source}" — expected "modrinth:<slug>" where slug matches /^[a-z0-9][a-z0-9-_]*$/`,
        );
      }
      return { kind: "modrinth", slug: rest, version };
    }
    case "maven": {
      const parts = rest.split(":");
      if (parts.length !== 2) {
        throw new Error(`Invalid source: "${source}" — expected "maven:<groupId>:<artifactId>"`);
      }
      const [groupId, artifactId] = parts;
      if (!MAVEN_COORD_RE.test(groupId) || !MAVEN_COORD_RE.test(artifactId)) {
        throw new Error(
          `Invalid source: "${source}" — groupId/artifactId must match /^[a-zA-Z][\\w.-]*$/`,
        );
      }
      return { kind: "maven", groupId, artifactId, version };
    }
    case "file": {
      if (rest.length === 0) {
        throw new Error(
          `Invalid source: "${source}" — expected "file:<path>" with a non-empty path`,
        );
      }
      return { kind: "file", path: rest, version };
    }
    case "workspace": {
      if (rest.length === 0) {
        throw new Error(
          `Invalid source: "${source}" — expected "workspace:<name>" with a non-empty name`,
        );
      }
      return { kind: "workspace", name: rest, version };
    }
    default: {
      throw new Error(
        `Invalid source: "${source}" — unknown scheme "${scheme}" (expected "modrinth", "maven", "file", or "workspace")`,
      );
    }
  }
}

/**
 * Parse a CLI identifier (as passed to `pluggy install <x>`).
 *
 * Accepts:
 *   - `<slug>[@<version>]`                   (Modrinth)
 *   - `<path-to.jar>`                        (local file)
 *   - `maven:<groupId>:<artifactId>@<version>`
 *   - `workspace:<name>`
 *
 * If no version is specified for Modrinth/Maven, returns the latest-stable
 * sentinel (`"*"`); resolver is responsible for concretizing.
 *
 * Throws on malformed input.
 */
export function parseIdentifier(input: string): ResolvedSource {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`Invalid identifier: "${input}" — expected a non-empty string`);
  }

  // File form: anything ending in ".jar" (case-insensitive on the extension).
  if (/\.jar$/i.test(input)) {
    return { kind: "file", path: input, version: LATEST_STABLE };
  }

  // maven:<groupId>:<artifactId>@<version>
  if (input.startsWith("maven:")) {
    const rest = input.slice("maven:".length);
    const atIndex = rest.lastIndexOf("@");
    if (atIndex === -1) {
      throw new Error(
        `Invalid identifier: "${input}" — expected "maven:<groupId>:<artifactId>@<version>"`,
      );
    }
    const coord = rest.slice(0, atIndex);
    const version = rest.slice(atIndex + 1);
    if (version.length === 0) {
      throw new Error(`Invalid identifier: "${input}" — version after "@" must not be empty`);
    }
    const parts = coord.split(":");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid identifier: "${input}" — expected "maven:<groupId>:<artifactId>@<version>"`,
      );
    }
    const [groupId, artifactId] = parts;
    if (!MAVEN_COORD_RE.test(groupId) || !MAVEN_COORD_RE.test(artifactId)) {
      throw new Error(
        `Invalid identifier: "${input}" — groupId/artifactId must match /^[a-zA-Z][\\w.-]*$/`,
      );
    }
    return { kind: "maven", groupId, artifactId, version };
  }

  // workspace:<name>
  if (input.startsWith("workspace:")) {
    const name = input.slice("workspace:".length);
    if (name.length === 0) {
      throw new Error(
        `Invalid identifier: "${input}" — expected "workspace:<name>" with a non-empty name`,
      );
    }
    if (name.includes("@")) {
      throw new Error(
        `Invalid identifier: "${input}" — workspace identifiers do not accept a version`,
      );
    }
    return { kind: "workspace", name, version: LATEST_STABLE };
  }

  // Modrinth: <slug>[@<version>]
  // Reject identifiers with more than one '@' to avoid ambiguity.
  const atIndex = input.indexOf("@");
  if (atIndex !== -1 && input.indexOf("@", atIndex + 1) !== -1) {
    throw new Error(
      `Invalid identifier: "${input}" — multiple "@" separators; expected "<slug>[@<version>]"`,
    );
  }
  let slug: string;
  let version: string;
  if (atIndex === -1) {
    slug = input;
    version = LATEST_STABLE;
  } else {
    slug = input.slice(0, atIndex);
    version = input.slice(atIndex + 1);
    if (version.length === 0) {
      throw new Error(`Invalid identifier: "${input}" — version after "@" must not be empty`);
    }
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid identifier: "${input}" — slug must match /^[a-z0-9][a-z0-9-_]*$/`);
  }
  return { kind: "modrinth", slug, version };
}

/**
 * Serialize a ResolvedSource back into the `project.json` source-string form.
 * The version component is NOT included (it lives in its own field).
 */
export function stringifySource(source: ResolvedSource): string {
  switch (source.kind) {
    case "modrinth":
      return `modrinth:${source.slug}`;
    case "maven":
      return `maven:${source.groupId}:${source.artifactId}`;
    case "file":
      return `file:${source.path}`;
    case "workspace":
      return `workspace:${source.name}`;
  }
}
