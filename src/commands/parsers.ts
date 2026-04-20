import { InvalidArgumentError } from "commander";

import { getRegisteredPlatforms } from "../platform/mod.ts";
import { parseIdentifier } from "../source.ts";

/**
 * Commander argParser that validates a CLI plugin identifier — the full
 * grammar from §6.2 (`<slug>[@<version>]`, `<path>.jar`, `maven:g:a@v`,
 * `workspace:<name>`). Returns the input string untouched; downstream code
 * calls `parseIdentifier` again to get the tagged union.
 *
 * Commander wants a string back from argParsers (otherwise the typed value
 * replaces the raw input in help text, etc.), so we validate then pass through.
 */
export function parseIdentifierArg(value: string): string {
  try {
    parseIdentifier(value);
  } catch (err) {
    throw new InvalidArgumentError((err as Error).message);
  }
  return value;
}

export function parseSemver(value: string): string {
  if (/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(value)) return value;
  throw new InvalidArgumentError(
    `Invalid semver version: ${value} - expected format like 1.0.0 or 1.0.0-alpha`,
  );
}

export function parsePlatform(value: string): string {
  const platforms = getRegisteredPlatforms();
  const id = value.toLowerCase();
  if (!platforms.includes(id)) {
    throw new InvalidArgumentError(
      `Invalid platform: "${value}". Available platforms: ${platforms.join(", ")}`,
    );
  }
  return id;
}

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`Invalid integer: ${value}`);
  return parsed;
}
