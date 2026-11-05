import { describe, expect, it } from "vitest";
import { parseCents } from "@/lib/finance";

describe("parseCents", () => {
  it("converte importi italiani in centesimi interi", () => {
    expect(parseCents("45,90")).toBe(4590);
    expect(parseCents("1.250,00")).toBe(125000);
    expect(parseCents("12.5")).toBe(1250);
  });
  it("rifiuta più di due decimali e negativi se non ammessi", () => {
    expect(parseCents("1,234")).toBeNull();
    expect(parseCents("-10")).toBeNull();
    expect(parseCents("-10", true)).toBe(-1000);
  });
});
