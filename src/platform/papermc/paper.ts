import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPlatform, type Version } from "../platform.ts";
import * as papermc from "./papermc.ts";

export default createPlatform((ctx) => ({
  id: "paper",

  async getVersionInfo(version: string): Promise<Version> {
    const versionsList = await papermc.versions("paper");
    const versionInfo = versionsList.find((v) => v.version.id === version);
    if (!versionInfo) throw new Error(`Failed to fetch version info for ${version}`);
    return { version, build: versionInfo.builds[0] };
  },

  async getLatestVersion(): Promise<Version> {
    const versionsList = await papermc.versions("paper");
    if (versionsList.length === 0) throw new Error("No versions found for paper");
    const latestVersion = versionsList[0];
    return { version: latestVersion.version.id, build: latestVersion.builds[0] };
  },

  async getVersions(): Promise<string[]> {
    const versionsList = await papermc.versions("paper");
    return versionsList.map((v) => v.version.id);
  },

  api(version: string) {
    return Promise.resolve({
      repositories: ["https://repo.papermc.io/repository/maven-public/"],
      dependencies: [
        {
          groupId: "io.papermc.paper",
          artifactId: "paper-api",
          version: `${version}-R0.1-SNAPSHOT`,
        },
      ],
    });
  },

  async download(version: Version, ignoreCache = false) {
    const CACHE_PATH = ctx.getCachePath();
    const JAR_PATH = join(CACHE_PATH, "versions", `paper-${version.version}-${version.build}.jar`);

    if (existsSync(JAR_PATH) && !ignoreCache) {
      return {
        version: version.version,
        build: version.build,
        output: new Uint8Array(readFileSync(JAR_PATH)),
      };
    }

    const result = await papermc.download("paper", version.version, version.build);
    const output = new Uint8Array(result.output);

    await mkdir(join(CACHE_PATH, "versions"), { recursive: true });
    await writeFile(JAR_PATH, output);
    return { version: result.version, build: result.build, output };
  },
}));
