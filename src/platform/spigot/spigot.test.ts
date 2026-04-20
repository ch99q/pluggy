import process from "node:process";

import { expect, test } from "vite-plus/test";

import { getPlatform } from "../index.ts";

// spigot.download runs BuildTools — slow and Java-dependent. Gated behind PLUGGY_INTEGRATION=1.
const integration = process.env.PLUGGY_INTEGRATION === "1";

test("spigot platform exists", () => {
  expect(getPlatform("spigot").id).toBe("spigot");
  expect(getPlatform("Spigot").id).toBe("spigot");
  expect(() => getPlatform("@Spigot")).toThrow("Platform with id '@Spigot' not found");
});

test("spigot platform versions", async () => {
  const spigot = getPlatform("spigot");
  const versions = await spigot.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["1.20.5", "1.20.4", "1.20.3"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await spigot.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test.runIf(integration)("spigot platform download latest version", async () => {
  const spigot = getPlatform("spigot");
  const latestVersion = await spigot.getLatestVersion();
  const result = await spigot.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});

test("spigot maven repository for api", async () => {
  const spigot = getPlatform("spigot");
  const latestVersion = await spigot.getLatestVersion();
  const api = await spigot.api(latestVersion.version);

  expect(api.repositories).toEqual(
    expect.arrayContaining(["https://hub.spigotmc.org/nexus/content/repositories/snapshots/"]),
  );
  expect(api.dependencies).toEqual(
    expect.arrayContaining([
      {
        groupId: "org.spigotmc",
        artifactId: "spigot-api",
        version: `${latestVersion.version}-R0.1-SNAPSHOT`,
      },
    ]),
  );
});
