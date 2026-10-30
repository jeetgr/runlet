import { app } from "./app";
import { env } from "./env";
import { logger } from "./lib/logger";

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

logger.info({ port: server.port }, "server listening");
