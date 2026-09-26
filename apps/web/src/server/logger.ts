import "server-only";
import pino, { type Logger } from "pino";
import { getEnv } from "./env";

let logger: Logger | undefined;

export function getLogger(): Logger {
  logger ??= pino({ level: getEnv().LOG_LEVEL, base: { service: "web" } });
  return logger;
}
