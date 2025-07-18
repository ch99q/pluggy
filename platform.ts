// deno-lint-ignore-file no-explicit-any
import { parse } from "jsr:@libs/xml"

export const SPIGOT_MAVEN_REPO = "https://hub.spigotmc.org/nexus/content/repositories/snapshots/org/spigotmc/spigot-api";
export const PAPER_MAVEN_REPO = "https://repo.papermc.io/repository/maven-snapshots/io/papermc/paper/paper-api";

export type Platform = "spigot" | "paper";
export const PLATFORMS: Platform[] = ["spigot", "paper"];

export const checkPlatform = (platform: string): Platform => {
  if (!PLATFORMS.includes(platform as Platform)) {
    throw new Error(`Invalid platform: ${platform}. Supported platforms are '${PLATFORMS.join("', '")}'.`);
  }
  return platform as Platform;
};

export const getPlatformRepository = (platform: Platform): string => {
  checkPlatform(platform);
  switch (platform) {
    case "spigot":
      return SPIGOT_MAVEN_REPO;
    case "paper":
      return PAPER_MAVEN_REPO;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
};

export interface SnapshotMetadata {
  timestamp: string;
  artifactId: string;
  buildNumber: string;
  version: string;
  target: string; // 1.20.4, 1.21.7, etc.
}

export async function resolveRepository(repositoryUrl: string): Promise<SnapshotMetadata> {
  const metadataUrl = `${repositoryUrl}/maven-metadata.xml`;
  const response = await fetch(metadataUrl);
  if (!response.ok) throw new Error("Unable to find repository metadata at " + metadataUrl);
  const xml = parse(await response.text()) as any;
  if (!xml.metadata || !xml.metadata?.versioning?.latest) throw new Error("Invalid repository metadata format");
  return resolveSnapshot(repositoryUrl, xml.metadata.versioning.latest.split("-")[0]);
}

export async function resolveSnapshot(repositoryUrl: string, version: string): Promise<SnapshotMetadata> {
  const metadataUrl = `${repositoryUrl}/${version}-R0.1-SNAPSHOT/maven-metadata.xml`;
  const response = await fetch(metadataUrl);
  if (!response.ok) throw new Error("Unable to find snapshot metadata for version " + version);
  const xml = parse(await response.text()) as any;
  if (!xml.metadata || !xml.metadata?.version || !xml.metadata?.versioning.snapshot.timestamp || !xml.metadata?.versioning.snapshot.buildNumber) {
    throw new Error("Invalid snapshot metadata format");
  }
  return {
    timestamp: xml.metadata.versioning.snapshot.timestamp,
    buildNumber: xml.metadata.versioning.snapshot.buildNumber,
    artifactId: xml.metadata.artifactId,
    version: `${xml.metadata.artifactId}-${version}-R0.1-${xml.metadata.versioning.snapshot.timestamp}-${xml.metadata.versioning.snapshot.buildNumber}`,
    target: version
  }
}

export interface SnapshotJarMetadata extends SnapshotMetadata {
  data: Uint8Array;
}

export async function downloadSnapshot(repositoryUrl: string, version: string): Promise<SnapshotJarMetadata> {
  const snapshotVersion = await resolveSnapshot(repositoryUrl, version);
  if (!snapshotVersion) throw new Error(`Failed to resolve snapshot for version ${version}`);
  const downloadUrl = `${repositoryUrl}/${version}-R0.1-SNAPSHOT/${snapshotVersion.version}.jar`;
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Failed to download from ${downloadUrl}: ${response.status} ${response.statusText}`);
  return Object.assign({
    data: new Uint8Array(await response.arrayBuffer())
  }, snapshotVersion);
}
