/**
 * Tests for src/commands/search.ts (the `doSearch` helper).
 *
 * Network I/O is mocked via `vi.stubGlobal("fetch", ...)`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { doSearch } from "./search.ts";

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, statusText: string): Response {
  return new Response(null, { status, statusText });
}

const origLog = console.log;
beforeEach(() => {
  console.log = () => {};
});
afterEach(() => {
  console.log = origLog;
  vi.unstubAllGlobals();
});

describe("doSearch", () => {
  test("hits the Modrinth search endpoint with plugin facet and returns hits", async () => {
    let capturedUrl = "";
    // Mock payload mirrors the real /v2/search response shape: `latest_version`
    // is an opaque Modrinth version ID (not a semver), `project_type` is
    // always "mod" even for plugins, and `versions` is the MC game-version list.
    const body = {
      hits: [
        {
          project_id: "hXiIvTyT",
          project_type: "mod",
          slug: "worldedit",
          author: "me4502",
          title: "WorldEdit",
          description: "In-game editor.",
          categories: ["bukkit", "paper", "spigot"],
          display_categories: ["bukkit", "paper"],
          versions: ["1.20.6", "1.21.4", "1.21.8"],
          downloads: 1000000,
          follows: 500,
          latest_version: "Oa9ZDzZq",
          license: "GPL-3.0-only",
          client_side: "unsupported",
          server_side: "required",
        },
      ],
      offset: 0,
      limit: 10,
      total_hits: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL): Promise<Response> => {
        capturedUrl = String(url);
        return okJson(body);
      }),
    );

    const result = await doSearch("worldedit", { size: 10, page: 0, json: true });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].slug).toBe("worldedit");
    expect(result.total).toBe(1);
    expect(result.page).toBe(0);
    expect(result.size).toBe(10);

    // Facets always include project_type:plugin.
    expect(capturedUrl).toContain("facets=");
    const parsed = new URL(capturedUrl);
    const facets = JSON.parse(parsed.searchParams.get("facets") ?? "[]");
    expect(facets).toEqual([["project_type:plugin"]]);
    expect(parsed.searchParams.get("query")).toBe("worldedit");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("offset")).toBe("0");
  });

  test("adds platform and version facets when provided, computes offset from page", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL): Promise<Response> => {
        capturedUrl = String(url);
        return okJson({ hits: [], offset: 0, limit: 5, total_hits: 0 });
      }),
    );

    await doSearch("chat", {
      size: 5,
      page: 3,
      platform: "paper",
      version: "1.21.8",
      json: true,
    });

    const parsed = new URL(capturedUrl);
    const facets = JSON.parse(parsed.searchParams.get("facets") ?? "[]");
    expect(facets).toEqual([["project_type:plugin"], ["categories:paper"], ["versions:1.21.8"]]);
    expect(parsed.searchParams.get("offset")).toBe("15"); // 5 * 3
  });

  test("throws with a helpful message on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "Internal Server Error")),
    );
    await expect(doSearch("x", { size: 10, page: 0, json: true })).rejects.toThrow(
      /Modrinth search failed.*"x".*500/s,
    );
  });

  test("json mode emits a status-success envelope to stdout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          hits: [{ slug: "a", title: "A" }],
          offset: 0,
          limit: 10,
          total_hits: 1,
        }),
      ),
    );

    const captured: string[] = [];
    console.log = (s: string) => {
      captured.push(s);
    };
    try {
      await doSearch("a", { size: 10, page: 0, json: true });
    } finally {
      console.log = origLog;
    }
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]);
    expect(parsed.status).toBe("success");
    expect(parsed.hits[0].slug).toBe("a");
    expect(parsed.total).toBe(1);
  });
});
