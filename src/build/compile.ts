import type { ResolvedProject } from "../project.ts";

export interface CompileOptions {
  sourceDir: string;
  outputDir: string;
  classpath: string[];
}

export function compileJava(_project: ResolvedProject, _opts: CompileOptions): Promise<void> {
  throw new Error("not implemented: compileJava");
}
