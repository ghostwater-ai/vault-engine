import { describe, it, expect } from "vitest";

describe("@ghostwater/vault-engine-openclaw", () => {
  it("should be importable", async () => {
    const mod = await import("./index.js");
    expect(mod).toBeDefined();
  });
});
