import { createLogger } from "@repo/logger";

import { env } from "../env";

export const logger = createLogger({
  name: "worker",
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV !== "production",
});
