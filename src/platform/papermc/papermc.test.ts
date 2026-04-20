import { expect, test } from "vite-plus/test";
import { download, versions } from "./papermc.ts";

test("papermc versions", async () => {
  const result = await versions("paper");
  expect(result.length).toBeGreaterThan(0);
});

test("papermc download latest version", async () => {
  const versionsList = await versions("paper");
  expect(versionsList.length).toBeGreaterThan(0);
  const latestVersion = versionsList[0].version.id;
  const result = await download("paper", latestVersion);
  expect(result.version).toBe(latestVersion);
  expect(result.build).toBeGreaterThan(0);
  expect(result.output instanceof ArrayBuffer).toBe(true);
});
