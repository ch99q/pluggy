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
export function parseSource(_source: string, _version: string): ResolvedSource {
  throw new Error("not implemented: parseSource");
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
export function parseIdentifier(_input: string): ResolvedSource {
  throw new Error("not implemented: parseIdentifier");
}

/**
 * Serialize a ResolvedSource back into the `project.json` source-string form.
 * The version component is NOT included (it lives in its own field).
 */
export function stringifySource(_source: ResolvedSource): string {
  throw new Error("not implemented: stringifySource");
}
