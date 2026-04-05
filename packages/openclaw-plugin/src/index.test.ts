import { describe, it, expect } from "vitest";
import { vi } from "vitest";

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: <T>(entry: T) => entry,
}), { virtual: true });

vi.mock("@ghostwater/vault-engine", () => ({
  rebuildIndex: vi.fn(),
  query: vi.fn(),
}));

describe("@ghostwater/vault-engine-openclaw", () => {
  it("should be importable", async () => {
    const mod = await import("./index.js");
    expect(mod).toBeDefined();
  });
});
