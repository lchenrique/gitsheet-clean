import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getRequiredEnv } from "@/lib/env";
import * as schema from "@/lib/schema";

declare global {
  // eslint-disable-next-line no-var
  var __gitsheetDrizzle: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

export function getDb() {
  if (!globalThis.__gitsheetDrizzle) {
    const sql = neon(getRequiredEnv("DATABASE_URL"));
    globalThis.__gitsheetDrizzle = drizzle(sql, { schema });
  }

  return globalThis.__gitsheetDrizzle;
}
