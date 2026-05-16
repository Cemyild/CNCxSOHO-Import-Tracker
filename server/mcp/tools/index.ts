// server/mcp/tools/index.ts
// Each dynamic import triggers the module's registerTool() side effects.
// Phase 3+ populates this list incrementally.
// We use dynamic await import() (not require()) because this project is pure
// ESM ("type": "module") and require is not defined in module scope under tsx.
export async function registerAllTools(): Promise<void> {
  // Read tools (Phase 3)
  await import("./procedures");
  await import("./taxes");
  await import("./expenses");
  await import("./payments");
  await import("./invoices");
  await import("./products");
  await import("./reports");
}
