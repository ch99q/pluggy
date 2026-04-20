import { expect, test } from "vite-plus/test";
import { getPlatform } from "../mod.ts";

test("travertine platform exists", () => {
  expect(getPlatform("travertine").id).toBe("travertine");
  expect(getPlatform("Travertine").id).toBe("travertine");
  expect(() => getPlatform("@Travertine")).toThrow("Platform with id '@Travertine' not found");
});

test("travertine platform versions", async () => {
  const travertine = getPlatform("travertine");
  const versions = await travertine.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["1.16", "1.15", "1.14"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await travertine.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test("travertine platform download latest version", async () => {
  const travertine = getPlatform("travertine");
  const latestVersion = await travertine.getLatestVersion();
  const result = await travertine.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});
