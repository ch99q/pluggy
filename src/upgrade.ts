import { Command } from "commander";

import { bold, brightBlue } from "./logging.ts";

interface GithubRelease {
  tag_name: string;
  html_url: string;
  name: string;
  published_at: string;
}

export interface UpgradeOptions {
  repository: string;
  token?: string;
}

async function fetchLatestRelease(repository: string, token?: string): Promise<GithubRelease> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `token ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers,
  });
  if (!res.ok) throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as GithubRelease & { message?: string };
  if (data.message) throw new Error(`GitHub API error: ${data.message}`);
  return data;
}

export function UpgradeCommand(options: UpgradeOptions): Command {
  return new Command("upgrade")
    .description("Upgrade pluggy to the latest version.")
    .action(async () => {
      const release = await fetchLatestRelease(options.repository, options.token);
      console.log(`${bold("Latest release:")} ${brightBlue(release.tag_name)}`);
      console.log(`${bold("Published:")}      ${release.published_at}`);
      console.log(`${bold("URL:")}            ${release.html_url}\n`);
      console.log("Re-run the install script to upgrade:\n");
      console.log(
        `  ${bold("Unix")}:    curl -fsSL https://github.com/${options.repository}/releases/latest/download/install.sh | bash`,
      );
      console.log(
        `  ${bold("Windows")}: irm https://github.com/${options.repository}/releases/latest/download/install.ps1 | iex`,
      );
    });
}
