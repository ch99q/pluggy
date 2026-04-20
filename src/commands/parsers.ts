/**
 * commander argParser functions. Each validates, throws `InvalidArgumentError`
 * on failure, and returns the parsed value — commander interpolates the
 * return value into the parsed option.
 */

import { InvalidArgumentError } from "commander";

import { getRegisteredPlatforms } from "../platform/mod.ts";
import { parseIdentifier } from "../source.ts";

/**
 * Validate a plugin identifier and return the raw string. Downstream code
 * calls `parseIdentifier` again for the tagged union; this parser exists so
 * commander surfaces malformed identifiers at parse time.
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
