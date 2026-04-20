import type { ResolvedProject } from "../project.ts";

import { getCachePath } from "../project.ts";

export interface Version {
  version: string;
  build: number;
}

export interface MavenAPI {
  repositories: string[];
  dependencies: Array<{ groupId: string; artifactId: string; version: string }>;
}

export interface DescriptorSpec {
  /** Path inside the final plugin jar where the descriptor is written. */
  path: string;
  format: "yaml" | "json" | "toml";
  /** Serialize the descriptor for a given project. */
  generate(project: ResolvedProject): string;
}

export interface PlatformProvider {
  id: string;
  descriptor: DescriptorSpec;

  getVersions(): Promise<string[]>;
  getLatestVersion(): Promise<Version>;
  getVersionInfo(version: string): Promise<Version>;

  /**
   * Downloads the platform executable and stores it in the cache.
   * @returns A promise that resolves to the path where the executable is stored.
   */
  download(version: Version, ignoreCache: boolean): Promise<Version & { output: Uint8Array }>;

  api(version: string): Promise<MavenAPI>;
}

export interface PlatformContext {
  getCachePath(): string;
}

const PLATFORMS: Record<string, PlatformProvider> = {};

export function createPlatform<T extends PlatformProvider>(
  provider: (context: PlatformContext) => T,
): T {
  const platform = provider({ getCachePath });
  PLATFORMS[platform.id.toLowerCase()] = platform;
  return platform;
}

export function getPlatform(providerId: string): PlatformProvider {
  const id = providerId.toLowerCase();
  if (!PLATFORMS[id]) throw new Error(`Platform with id '${providerId}' not found`);
  return PLATFORMS[id];
}

export function getRegisteredPlatforms(): string[] {
  return Object.keys(PLATFORMS);
}
