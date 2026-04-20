import { InvalidArgumentError } from "commander";

import { getRegisteredPlatforms } from "../platform/mod.ts";

export function parseVersion(value: string): string {
  if (/^\d+\.\d+\.\d+?$/.test(value)) return value;
  if (/^.+\.jar$/.test(value)) return value;
  if (/^maven:[\w.-]+:[\w.-]+@.+$/.test(value)) return value;
  throw new InvalidArgumentError(
    `Invalid version format: ${value} - expected semver, file jar, or maven format`,
  );
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
