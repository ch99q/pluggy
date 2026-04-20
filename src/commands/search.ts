import { Command } from "commander";

import { bold, dim, log } from "../logging.ts";

import { parseInteger, parsePlatform, parseSemver } from "./parsers.ts";

const MODRINTH_API = "https://api.modrinth.com/v2";

interface ModrinthSearchHit {
  slug: string;
  title: string;
  description?: string;
  categories?: string[];
  client_side?: string;
  server_side?: string;
  project_type?: string;
  downloads?: number;
  icon_url?: string;
  project_id?: string;
  author?: string;
  display_categories?: string[];
  versions?: string[];
  latest_version?: string;
  license?: string;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface SearchOptions {
  size: number;
  page: number;
  platform?: string;
  version?: string;
  beta?: boolean;
  json?: boolean;
}

export interface SearchResult {
  hits: ModrinthSearchHit[];
  page: number;
  size: number;
  total: number;
}

/**
 * Perform the `search` action. Exposed as a helper so tests can drive it
 * without going through commander.
 */
export async function doSearch(query: string, options: SearchOptions): Promise<SearchResult> {
  if (typeof query !== "string" || query.length === 0) {
    throw new Error('search query must be a non-empty string (got "")');
  }

  const facets: string[][] = [["project_type:plugin"]];
  if (options.platform) facets.push([`categories:${options.platform}`]);
  if (options.version) facets.push([`versions:${options.version}`]);

  // Modrinth's search endpoint has no project-level pre-release filter. The
  // `--beta` flag gates version resolution later; here it's a no-op, but we
  // still warn when the user set it so the limitation is surfaced.
  if (options.beta && !options.json) {
    log.warn(
      "--beta has no effect on search (no project-level pre-release filter); it's honored later at resolve time",
    );
  }

  const params = new URLSearchParams();
  params.set("query", query);
  params.set("limit", String(options.size));
  params.set("offset", String(options.size * options.page));
  params.set("facets", JSON.stringify(facets));

  const url = `${MODRINTH_API}/search?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Modrinth search failed for "${query}": ${res.status} ${res.statusText} (${url})`,
    );
  }
  const data = (await res.json()) as ModrinthSearchResponse;
  if (data === null || typeof data !== "object" || !Array.isArray(data.hits)) {
    throw new Error(`Modrinth search returned malformed response for "${query}" (${url})`);
  }

  const result: SearchResult = {
    hits: data.hits,
    page: options.page,
    size: options.size,
    total: data.total_hits ?? data.hits.length,
  };

  if (options.json) {
    console.log(JSON.stringify({ status: "success", ...result }, null, 2));
  } else {
    printHumanSearch(query, result);
  }

  return result;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function printHumanSearch(query: string, result: SearchResult): void {
  if (result.hits.length === 0) {
    log.info(dim(`No results for "${query}".`));
    return;
  }
  log.info(
    dim(
      `page ${result.page} • ${result.hits.length} of ${result.total} result${result.total === 1 ? "" : "s"}`,
    ),
  );
  for (const hit of result.hits) {
    const latest = hit.latest_version ?? "?";
    const downloads = hit.downloads ?? 0;
    log.info("");
    log.info(`${bold(hit.title)}  ${dim(`(${hit.slug})`)}  ${dim(`v${latest}`)}`);
    const desc = truncate(hit.description, 120);
    if (desc) log.info(`  ${desc}`);
    log.info(`  ${dim(`downloads: ${downloads.toLocaleString()}`)}`);
    log.info(`  ${dim(`https://modrinth.com/plugin/${hit.slug}`)}`);
  }
}

export function searchCommand(): Command {
  return new Command("search")
    .description("Search Modrinth for plugins by keyword.")
    .argument("<query>", "Search query.")
    .option("--size <size>", "Page size (default: 10).", parseInteger, 10)
    .option("--page <page>", "Page number (default: 0).", parseInteger, 0)
    .option("--platform <name>", "Filter by platform.", parsePlatform)
    .option("--version <semver>", "Filter by Minecraft version.", parseSemver)
    .option("--beta", "Include pre-releases.")
    .action(async function action(this: Command, query: string, options) {
      const globalOpts = this.optsWithGlobals();
      await doSearch(query, {
        size: options.size,
        page: options.page,
        platform: options.platform,
        version: options.version,
        beta: options.beta,
        json: globalOpts.json,
      });
    });
}
