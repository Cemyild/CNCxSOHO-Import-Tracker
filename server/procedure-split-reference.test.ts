import { describe, it, expect, vi } from "vitest";

/**
 * Only the pure helpers are under test. loadSplitPlan lives in the same module
 * and imports ./db, which refuses to load without DATABASE_URL — stub it.
 */
vi.mock("./db", () => ({ db: {}, pool: {}, rawDb: {} }));

import {
  parseReference,
  formatSplitReference,
  isSiblingOf,
  planSplit,
  likeEscape,
} from "./procedure-split-reference";

describe("parseReference", () => {
  it("splits the canonical spaced form", () => {
    expect(parseReference("CNCALO-108 / 1")).toEqual({ root: "CNCALO-108", part: 1 });
  });

  it("splits legacy unspaced and half-spaced forms", () => {
    expect(parseReference("CNCALO-108/1")).toEqual({ root: "CNCALO-108", part: 1 });
    expect(parseReference("CNCALO-83 /1")).toEqual({ root: "CNCALO-83", part: 1 });
  });

  it("trims trailing whitespace left by old data", () => {
    expect(parseReference("CNCALO-85 /1 ")).toEqual({ root: "CNCALO-85", part: 1 });
  });

  it("keeps roots that contain spaces and dashes", () => {
    expect(parseReference("CNCALO-33 - GARMENTS/1")).toEqual({
      root: "CNCALO-33 - GARMENTS",
      part: 1,
    });
    expect(parseReference("CNCALO-42 -GARMENTS/3")).toEqual({
      root: "CNCALO-42 -GARMENTS",
      part: 3,
    });
  });

  it("reports no part for a plain reference", () => {
    expect(parseReference("CNCALO-108")).toEqual({ root: "CNCALO-108", part: null });
  });
});

describe("formatSplitReference", () => {
  it("always writes the spaced form", () => {
    expect(formatSplitReference("CNCALO-108", 2)).toBe("CNCALO-108 / 2");
    expect(formatSplitReference("CNCALO-108 ", 2)).toBe("CNCALO-108 / 2");
  });
});

describe("isSiblingOf", () => {
  it("accepts the root itself and its numbered forms", () => {
    expect(isSiblingOf("CNCALO-108", "CNCALO-108")).toBe(true);
    expect(isSiblingOf("CNCALO-108", "CNCALO-108 /2")).toBe(true);
    expect(isSiblingOf("CNCALO-108", "CNCALO-108/3")).toBe(true);
  });

  it("rejects a longer number that merely starts the same", () => {
    expect(isSiblingOf("CNCALO-108", "CNCALO-1080")).toBe(false);
    expect(isSiblingOf("CNCALO-108", "CNCALO-1080 / 1")).toBe(false);
    expect(isSiblingOf("CNCALO-10", "CNCALO-108")).toBe(false);
  });
});

describe("planSplit", () => {
  it("renames an unnumbered source to / 1 and gives the new one / 2", () => {
    const plan = planSplit("CNCALO-120", ["CNCALO-120"]);
    expect(plan.sourceRename).toEqual({ from: "CNCALO-120", to: "CNCALO-120 / 1" });
    expect(plan.newReference).toBe("CNCALO-120 / 2");
  });

  it("does not reuse a number that already exists (real CNCALO-108 data)", () => {
    const plan = planSplit("CNCALO-108", ["CNCALO-108", "CNCALO-108 /2"]);
    expect(plan.sourceRename).toEqual({ from: "CNCALO-108", to: "CNCALO-108 / 1" });
    expect(plan.newReference).toBe("CNCALO-108 / 3");
  });

  it("leaves an already numbered source alone", () => {
    const plan = planSplit("CNCALO-108 / 1", ["CNCALO-108 / 1", "CNCALO-108 / 2"]);
    expect(plan.sourceRename).toBeNull();
    expect(plan.newReference).toBe("CNCALO-108 / 3");
  });

  it("ignores non-siblings when picking the next number", () => {
    const plan = planSplit("CNCALO-108", ["CNCALO-108", "CNCALO-1080 / 9"]);
    expect(plan.newReference).toBe("CNCALO-108 / 2");
  });
});

describe("likeEscape", () => {
  it("escapes SQL LIKE wildcards", () => {
    expect(likeEscape("A_B%C")).toBe("A\\_B\\%C");
    expect(likeEscape("CNCALO-108")).toBe("CNCALO-108");
  });
});

describe("loadSplitPlan export", () => {
  it("is exported so routes can plan a split from a procedure id", async () => {
    const mod = await import("./procedure-split-reference");
    expect(typeof mod.loadSplitPlan).toBe("function");
  });
});
