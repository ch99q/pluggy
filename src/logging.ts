import process from "node:process";
import pc from "picocolors";

const noColor = process.env.NO_COLOR !== undefined || process.argv.includes("--no-color");
const verbose =
  process.argv.includes("-v") ||
  process.argv.includes("--verbose") ||
  process.env.DEBUG !== undefined;

function color(fn: (s: string) => string): (s: string) => string {
  return noColor ? (s) => s : fn;
}

export const bold = color(pc.bold);
export const dim = color(pc.dim);
export const red = color(pc.red);
export const green = color(pc.green);
export const yellow = color(pc.yellow);
export const blue = color(pc.blue);
export const brightBlue = color(pc.blueBright);

export const log = {
  info(msg: string): void {
    console.log(msg);
  },
  debug(msg: string): void {
    if (verbose) console.log(dim(`◌ ${msg}`));
  },
  warn(msg: string): void {
    console.warn(`${yellow("⚠")} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${red("✖")} ${msg}`);
  },
  critical(msg: string): void {
    console.error(`${red("✖")} ${msg}`);
  },
  success(msg: string): void {
    console.log(`${green("✔")} ${msg}`);
  },
};
