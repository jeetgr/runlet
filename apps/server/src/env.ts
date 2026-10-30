import { createEnv } from "@t3-oss/env-core";
import * as v from "valibot";

export const env = createEnv({
  server: {
    NODE_ENV: v.optional(v.picklist(["development", "test", "production"]), "development"),
    LOG_LEVEL: v.optional(
      v.picklist(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
      "info",
    ),
    PORT: v.optional(
      v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(65535)),
      "3000",
    ),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
