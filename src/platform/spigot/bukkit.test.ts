import { expect, test } from "vite-plus/test";
import { getPlatform } from "../mod.ts";

test("bukkit platform exists", () => {
  expect(getPlatform("bukkit").id).toBe("bukkit");
  expect(getPlatform("Bukkit").id).toBe("bukkit");
  expect(() => getPlatform("@Bukkit")).toThrow("Platform with id '@Bukkit' not found");
});

test("bukkit platform versions", async () => {
  const bukkit = getPlatform("bukkit");
  const versions = await bukkit.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["1.20.5", "1.20.4", "1.20.3"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await bukkit.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test("bukkit platform download latest version", async () => {
  const bukkit = getPlatform("bukkit");
  const latestVersion = await bukkit.getLatestVersion();
  const result = await bukkit.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});
