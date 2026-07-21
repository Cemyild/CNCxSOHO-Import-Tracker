import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    // server/db.ts throws at import time if DATABASE_URL is unset, and
    // several server modules import it transitively (e.g. auth-middleware
    // -> storage -> db) even when a given test never issues a query. This
    // placeholder only satisfies that startup guard; no test in this suite
    // is allowed to actually query a database with it.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://placeholder:placeholder@localhost:5432/placeholder_do_not_use",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-placeholder-session-secret",
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
});
