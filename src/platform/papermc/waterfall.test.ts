import { expect, test } from "vite-plus/test";
import { getPlatform } from "../index.ts";

test("waterfall platform exists", () => {
  expect(getPlatform("waterfall").id).toBe("waterfall");
  expect(getPlatform("Waterfall").id).toBe("waterfall");
  expect(() => getPlatform("@Waterfall")).toThrow("Platform with id '@Waterfall' not found");
});

test("waterfall platform versions", async () => {
  const waterfall = getPlatform("waterfall");
  const versions = await waterfall.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["1.21", "1.20", "1.19", "1.18"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await waterfall.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test("waterfall platform download latest version", async () => {
  const waterfall = getPlatform("waterfall");
  const latestVersion = await waterfall.getLatestVersion();
  const result = await waterfall.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});
