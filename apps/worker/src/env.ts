import { logLevels } from "@repo/logger";
import { createEnv } from "@t3-oss/env-core";
import * as v from "valibot";

export const env = createEnv({
  server: {
    NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
    LOG_LEVEL: v.optional(v.picklist(logLevels), "info"),
    WORKER_CONCURRENCY: v.optional(
      v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)),
      () => String(navigator.hardwareConcurrency),
    ),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
