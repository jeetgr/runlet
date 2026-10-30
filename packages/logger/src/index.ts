import { pino, type LevelWithSilent, type Logger } from "pino";
import pinoPretty from "pino-pretty";

export type { Logger };

export type CreateLoggerOptions = {
  name: string;
  level: LevelWithSilent;
  /** Pretty-prints via an in-process stream; pino transports (worker threads) are avoided on Bun. */
  pretty: boolean;
};

export function createLogger({ name, level, pretty }: CreateLoggerOptions): Logger {
  return pretty ? pino({ name, level }, pinoPretty()) : pino({ name, level });
}
