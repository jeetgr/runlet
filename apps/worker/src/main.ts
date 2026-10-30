import { env } from "./env";
import { logger } from "./lib/logger";

logger.info({ concurrency: env.WORKER_CONCURRENCY }, "worker started");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "worker shutting down");
    process.exit(0);
  });
}
