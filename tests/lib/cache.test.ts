import { describe, expect, it } from "vitest";
import { truncateError, TtlCache } from "@/lib/cache";

describe("TtlCache & error helpers", () => {
  it("caches values until expiration and evicts oldest entry when full", () => {
    const cache = new TtlCache<string>(1000, 2);
    cache.set("a", "1", 1000, 100);
    cache.set("b", "2", 1000, 100);

    expect(cache.get("a", 500)).toBe("1");
    expect(cache.get("a", 1200)).toBeUndefined(); // expired

    cache.set("c", "3", 1000, 1300);
    cache.set("d", "4", 1000, 1300);
    expect(cache.size).toBe(2);
    expect(cache.get("c", 1400)).toBe("3");
    expect(cache.get("d", 1400)).toBe("4");
  });

  it("truncates overly verbose SQL error strings cleanly", () => {
    const longErr = new Error("x".repeat(600));
    const out = truncateError(longErr, 100);
    expect(out.length).toBe(103);
    expect(out.endsWith("...")).toBe(true);
  });
});
