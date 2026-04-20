import { chmod, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { Command } from "commander";

import { bold, brightBlue, dim, log, red, yellow } from "../logging.ts";

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  name: string;
  published_at: string;
  assets?: GithubReleaseAsset[];
}

export interface UpgradeOptions {
  /** GitHub `owner/repo` slug whose releases are queried. */
  repository: string;
  /** Optional GitHub token — only needed for rate-limited CI runs. */
  token?: string;
}

/**
 * Map `process.platform` + `process.arch` to the release asset name used
 * by `.github/workflows/release.yml`. Returns `undefined` when the current
 * platform isn't a published target — the action falls back to printing
 * manual install instructions.
 */
function currentAssetName(): string | undefined {
  const map: Record<string, string> = {
    "darwin-arm64": "pluggy-darwin-arm64",
    "darwin-x64": "pluggy-darwin-amd64",
    "linux-arm64": "pluggy-linux-arm64",
    "linux-x64": "pluggy-linux-amd64",
    "win32-x64": "pluggy-windows-amd64.exe",
  };
  return map[`${process.platform}-${process.arch}`];
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

function printManualInstructions(repository: string, release: GithubRelease): void {
  log.info(`${bold("Latest release:")} ${brightBlue(release.tag_name)}`);
  log.info(`${bold("Published:")}      ${release.published_at}`);
  log.info(`${bold("URL:")}            ${release.html_url}\n`);
  log.info("Install manually:\n");
  log.info(
    `  ${bold("Unix")}:    curl -fsSL https://github.com/${repository}/releases/latest/download/install.sh | bash`,
  );
  log.info(
    `  ${bold("Windows")}: irm https://github.com/${repository}/releases/latest/download/install.ps1 | iex`,
  );
}

/**
 * Download the release asset for the current platform into a temp file,
 * rename the running binary out of the way (Windows tolerates this; Unix
 * is routine), and move the new binary into its place. On failure, the
 * old binary is restored from the `.old` backup so the user isn't left
 * with a broken install.
 */
async function replaceInPlace(
  downloadUrl: string,
  currentBinaryPath: string,
): Promise<{ backupPath: string }> {
  const binaryRes = await fetch(downloadUrl);
  if (!binaryRes.ok) {
    throw new Error(
      `failed to download ${downloadUrl}: ${binaryRes.status} ${binaryRes.statusText}`,
    );
  }
  const bytes = new Uint8Array(await binaryRes.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`downloaded asset from ${downloadUrl} is empty`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "pluggy-upgrade-"));
  const stagedPath = join(tempDir, "pluggy-new");
  await writeFile(stagedPath, bytes);
  if (process.platform !== "win32") {
    await chmod(stagedPath, 0o755);
  }

  const backupPath = `${currentBinaryPath}.old`;
  await rm(backupPath, { force: true });

  await rename(currentBinaryPath, backupPath);
  try {
    await rename(stagedPath, currentBinaryPath);
  } catch (err) {
    // Best-effort restore so the user isn't left without a working binary.
    await rename(backupPath, currentBinaryPath).catch(() => {});
    throw new Error(
      `failed to install new binary at ${currentBinaryPath}; restored previous version: ${(err as Error).message}`,
    );
  }

  await rm(tempDir, { recursive: true, force: true });
  return { backupPath };
}

/**
 * Factory for the `pluggy upgrade` commander command.
 *
 * Default behaviour: fetch the latest GitHub release, download the asset
 * for the running platform, and atomically replace the current binary.
 * `--print-only` skips the replacement and prints manual instructions —
 * same behaviour we had before in-place upgrade was wired up.
 */
export function upgradeCommand(options: UpgradeOptions): Command {
  return new Command("upgrade")
    .description("Upgrade pluggy to the latest version.")
    .option(
      "--print-only",
      "Don't download; just print the latest release info and install commands.",
    )
    .action(async function action(this: Command, cmdOptions) {
      const release = await fetchLatestRelease(options.repository, options.token);

      if (cmdOptions.printOnly === true) {
        printManualInstructions(options.repository, release);
        return;
      }

      const assetName = currentAssetName();
      if (assetName === undefined) {
        log.warn(
          `${yellow("!")} No release asset available for ${process.platform}/${process.arch}; printing install instructions instead.`,
        );
        printManualInstructions(options.repository, release);
        return;
      }

      const downloadUrl = `https://github.com/${options.repository}/releases/download/${release.tag_name}/${assetName}`;
      const currentBinaryPath = process.execPath;

      log.info(`${bold("Upgrading to:")} ${brightBlue(release.tag_name)}`);
      log.info(`${dim(`downloading ${downloadUrl}`)}`);

      try {
        const { backupPath } = await replaceInPlace(downloadUrl, currentBinaryPath);
        log.success(
          `pluggy ${release.tag_name} installed at ${currentBinaryPath} (previous binary backed up to ${backupPath})`,
        );
      } catch (err) {
        log.error(`${red("✖")} ${(err as Error).message}`);
        printManualInstructions(options.repository, release);
        throw err;
      }
    });
}
