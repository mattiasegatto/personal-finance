import { describe, expect, it } from "vitest";
import { isCategoryUsable, parseCents } from "@/lib/finance";

describe("parseCents", () => {
  it("converte importi italiani in centesimi interi", () => {
    expect(parseCents("45,90")).toBe(4590);
    expect(parseCents("1.250,00")).toBe(125000);
    expect(parseCents("12.5")).toBe(1250);
  });
  it("interpreta i punti senza virgola come separatori delle migliaia", () => {
    expect(parseCents("2.000")).toBe(200000);
    expect(parseCents("1.250.000")).toBe(125000000);
    expect(parseCents("-2.000", true)).toBe(-200000);
    expect(parseCents("12.50")).toBe(1250);
    expect(parseCents("2.0000")).toBeNull();
  });
  it("rifiuta più di due decimali e negativi se non ammessi", () => {
    expect(parseCents("1,234")).toBeNull();
    expect(parseCents("-10")).toBeNull();
    expect(parseCents("-10", true)).toBe(-1000);
  });
});

describe("isCategoryUsable", () => {
  const parent = { id: "health", parent_id: null, archived_at: "2026-11-17T00:00:00Z" };
  const child = { id: "pharmacy", parent_id: "health", archived_at: null };
  const active = { id: "food", parent_id: null, archived_at: null };
  const byId = new Map([parent, child, active].map((c) => [c.id, c]));

  it("esclude le sottocategorie di un padre archiviato", () => {
    // Regressione: il modulo proponeva categorie che il database poi rifiutava.
    expect(isCategoryUsable(child, byId)).toBe(false);
    expect(isCategoryUsable(parent, byId)).toBe(false);
    expect(isCategoryUsable(active, byId)).toBe(true);
  });
});
