import type { DescriptorSpec } from "../platform.ts";

/**
 * Bukkit-family descriptor (paper, folia, spigot, bukkit).
 * Written to `plugin.yml` at the jar root.
 */
export const bukkitDescriptor: DescriptorSpec = {
  path: "plugin.yml",
  format: "yaml",
  generate(project) {
    if (!project.main) {
      throw new Error("Bukkit descriptor requires project.main");
    }

    const lines: string[] = [];
    lines.push(`name: ${yamlScalar(project.name)}`);
    lines.push(`version: ${yamlScalar(project.version)}`);
    lines.push(`main: ${yamlScalar(project.main)}`);

    if (project.description && project.description.length > 0) {
      lines.push(`description: ${yamlScalar(project.description)}`);
    }

    const apiVersion = deriveApiVersion(project.compatibility?.versions?.[0]);
    if (apiVersion) {
      lines.push(`api-version: ${yamlScalar(apiVersion)}`);
    }

    if (project.authors && project.authors.length > 0) {
      lines.push("authors:");
      for (const author of project.authors) {
        lines.push(`  - ${yamlScalar(author)}`);
      }
    }

    // Always LF; trailing newline so the file ends cleanly.
    return `${lines.join("\n")}\n`;
  },
};

/**
 * Derive a Bukkit `api-version` (major.minor) from a full MC version string.
 * e.g. "1.21.8" -> "1.21", "1.21" -> "1.21". Returns undefined for missing or
 * malformed input (fewer than 2 dot-segments that look like numbers).
 */
function deriveApiVersion(primaryVersion: string | undefined): string | undefined {
  if (!primaryVersion) return undefined;
  const parts = primaryVersion.split(".");
  if (parts.length < 2) return undefined;
  const [major, minor] = parts;
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor)) return undefined;
  return `${major}.${minor}`;
}

/**
 * Emit a YAML scalar. Quote when the value contains YAML-meaningful characters
 * or would otherwise be ambiguous (starts with a sigil, looks like a bool /
 * number / null, contains a colon-space, a hash, control chars, etc.).
 *
 * Booleans and numbers are emitted as bare tokens by the caller when
 * appropriate; this function always treats its input as a string value.
 */
function yamlScalar(value: string): string {
  if (value.length === 0) return '""';

  // Characters that force quoting when present anywhere in the string.
  // Colon, hash, quotes, backslash, tab, and anything in the block-structure
  // family. We conservatively quote on any of these rather than try to be
  // clever about "colon-space" vs "colon-end".
  const needsQuoteChars = /[:#"'\\\t\n\r]/.test(value);

  // Characters that force quoting only when they appear as the first char.
  const firstChar = value[0];
  const reservedFirst = "!&*?|>%@`-[]{},";
  const startsWithSpace = firstChar === " ";
  const endsWithSpace = value[value.length - 1] === " ";
  const startsWithReserved = reservedFirst.includes(firstChar);

  // Tokens YAML 1.1/1.2 interpret specially as scalars.
  const lowered = value.toLowerCase();
  const reservedWord =
    lowered === "true" ||
    lowered === "false" ||
    lowered === "yes" ||
    lowered === "no" ||
    lowered === "on" ||
    lowered === "off" ||
    lowered === "null" ||
    lowered === "~" ||
    lowered === "";
  const looksNumeric = /^-?\d+(\.\d+)?$/.test(value);

  if (
    !needsQuoteChars &&
    !startsWithReserved &&
    !startsWithSpace &&
    !endsWithSpace &&
    !reservedWord &&
    !looksNumeric
  ) {
    return value;
  }

  // Double-quote and escape \ and " (and control chars via JSON-style escapes).
  let escaped = "";
  for (const ch of value) {
    if (ch === "\\") escaped += "\\\\";
    else if (ch === '"') escaped += '\\"';
    else if (ch === "\n") escaped += "\\n";
    else if (ch === "\r") escaped += "\\r";
    else if (ch === "\t") escaped += "\\t";
    else escaped += ch;
  }
  return `"${escaped}"`;
}
