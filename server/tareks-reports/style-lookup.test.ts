import { describe, it, expect } from "vitest";
import { groupReportIdsByStyle } from "./style-lookup";

describe("groupReportIdsByStyle", () => {
  it("maps each style to the reports that cover it", () => {
    const got = groupReportIdsByStyle([
      { reportId: 1, style: "M3245R" },
      { reportId: 2, style: "M3245R" },
      { reportId: 2, style: "M5251R" },
    ]);
    expect(got.get("M3245R")).toEqual([1, 2]);
    expect(got.get("M5251R")).toEqual([2]);
  });

  it("matches regardless of case and surrounding whitespace", () => {
    // Styles come from two different tables (tax_calculation_items and
    // tareks_report_styles) and are typed by hand in both.
    const got = groupReportIdsByStyle([{ reportId: 7, style: " m3245r " }]);
    expect(got.get("M3245R")).toEqual([7]);
  });

  it("does not list the same report twice for one style", () => {
    const got = groupReportIdsByStyle([
      { reportId: 5, style: "M3245R" },
      { reportId: 5, style: "m3245r" },
    ]);
    expect(got.get("M3245R")).toEqual([5]);
  });

  it("ignores rows with an empty style", () => {
    const got = groupReportIdsByStyle([
      { reportId: 1, style: "" },
      { reportId: 2, style: "   " },
    ]);
    expect(got.size).toBe(0);
  });

  it("returns an empty map for no rows", () => {
    expect(groupReportIdsByStyle([]).size).toBe(0);
  });

  it("keeps report ids in ascending order", () => {
    const got = groupReportIdsByStyle([
      { reportId: 9, style: "A0059U" },
      { reportId: 3, style: "A0059U" },
      { reportId: 6, style: "A0059U" },
    ]);
    expect(got.get("A0059U")).toEqual([3, 6, 9]);
  });
});
