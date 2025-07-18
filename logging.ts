import { parseArgs } from "jsr:@std/cli/parse-args";
import { green, setColorEnabled, red, dim, yellow } from "jsr:@std/fmt/colors";
import { progress as logProgress } from "jsr:@ryweal/progress";

export * from "jsr:@std/fmt/colors";

import {
  setup as logSetup,
  info as logInfo,
  debug as logDebug,
  warn as logWarn,
  error as logError,
  critical as logCritical,
  ConsoleHandler,
} from "jsr:@std/log";

const args = parseArgs(Deno.args, {
  boolean: ["no-color", "verbose"],
  alias: {
    v: "verbose",
  }
});

if (args["no-color"]) setColorEnabled(false);

logSetup({
  handlers: {
    default: new ConsoleHandler("DEBUG", {
      formatter: ({ levelName, msg }) => {
        switch (levelName) {
          case "DEBUG":
            return dim(`◌ ${msg}`);
          case "CRITICAL":
            return `${red("✖")} ${msg}`;
          case "ERROR":
            return `${red("✖")} ${msg}`;
          case "WARN":
            return `${yellow("⚠")} ${msg}`;
        }
        return msg;
      },
      // Manually disable colors if the no-color flag is set.
      useColors: false,
    }),
  },
  ...(args.verbose ? {
    loggers: {
      default: {
        level: "DEBUG",
        handlers: ["default"],
      },
    },
  } : {})
});

function prompt(message: string, defaultValue?: string): string {
  const displayMessage = defaultValue
    ? `${green("?")} ${message} ${dim(`[${defaultValue}]`)}:`
    : `${green("?")} ${message}:`;

  const result = globalThis.prompt(displayMessage);
  return result || defaultValue || "";
}

export const log = {
  info: logInfo,
  debug: logDebug,
  warn: logWarn,
  error: logError,
  critical: logCritical,
  progress: logProgress,
  prompt,
  success: (msg: string) => {
    logInfo(`${green("✔")} ${msg}`);
  },
}
