import type { ResolvedProject } from "../project.ts";

/**
 * Prepare `<project>/dev/`: link the server jar, write `eula.txt`, render
 * `server.properties` from the project's `dev.serverProperties`. Returns
 * the absolute path to the staged dev directory.
 */
export function stageDev(
  _project: ResolvedProject,
  _platformJarPath: string,
  _opts: { clean?: boolean; freshWorld?: boolean },
): Promise<string> {
  throw new Error("not implemented: stageDev");
}
