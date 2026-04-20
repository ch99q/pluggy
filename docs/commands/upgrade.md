# `pluggy upgrade`

Replace the running pluggy binary with the latest GitHub release.

## Usage

```text
pluggy upgrade [options]
```

## Flags

| Flag           | Default | Notes                                                            |
| -------------- | ------- | ---------------------------------------------------------------- |
| `--print-only` | off     | Skip the download and print manual install instructions instead. |

## What it does

1. Queries `https://api.github.com/repos/ch99q/pluggy/releases/latest`.
2. Maps `process.platform` × `process.arch` to a release asset name:

   | Platform | Arch    | Asset                      |
   | -------- | ------- | -------------------------- |
   | `darwin` | `arm64` | `pluggy-darwin-arm64`      |
   | `darwin` | `x64`   | `pluggy-darwin-amd64`      |
   | `linux`  | `arm64` | `pluggy-linux-arm64`       |
   | `linux`  | `x64`   | `pluggy-linux-amd64`       |
   | `win32`  | `x64`   | `pluggy-windows-amd64.exe` |

3. Downloads the asset to `<tmp>/pluggy-upgrade-<rand>/pluggy-new` and
   `chmod +x` on POSIX.
4. Renames the current binary to `<current>.old`, then renames the staged
   new binary into place. On Windows this works because Node's `rename`
   will swap an open executable.
5. If the second rename fails, the `.old` backup is restored atomically.

Without an asset mapped for your platform, pluggy prints the manual
install instructions and exits clean.

## Human output

```text
$ pluggy upgrade
Upgrading to: v0.2.0
downloading https://github.com/ch99q/pluggy/releases/download/v0.2.0/pluggy-darwin-arm64
✔ pluggy v0.2.0 installed at /usr/local/bin/pluggy (previous binary backed up to /usr/local/bin/pluggy.old)
```

With `--print-only`:

```text
Latest release: v0.2.0
Published:      2026-03-01T12:00:00Z
URL:            https://github.com/ch99q/pluggy/releases/tag/v0.2.0

Install manually:

  Unix:    curl -fsSL https://github.com/ch99q/pluggy/releases/latest/download/install.sh | bash
  Windows: irm https://github.com/ch99q/pluggy/releases/latest/download/install.ps1 | iex
```

## Permissions

pluggy uses the path Node reports as `process.execPath`. On macOS and
Linux the install script drops the binary at `/usr/local/bin/pluggy`,
which is root-owned — upgrading on those systems requires running `pluggy
upgrade` with `sudo`, or installing the binary somewhere writable by your
user.

On Windows the install script places the binary at
`%LOCALAPPDATA%\Programs\pluggy\pluggy.exe`, which is user-writable.

## Error cases

| Trigger               | Message                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| GitHub API error      | `Failed to fetch latest release: <status> <statusText>`                      |
| GitHub rate-limit     | `GitHub API error: API rate limit exceeded ...`                              |
| Asset download fails  | `failed to download <url>: <status> <statusText>`                            |
| Empty asset           | `downloaded asset from <url> is empty`                                       |
| Rename-in-place fails | `failed to install new binary at <path>; restored previous version: <errno>` |

## See also

- [Cross-platform notes](../cross-platform.md) — where the binary lives on
  each OS.
