import { afterEach, describe, expect, it, vi } from "vitest";
import { activePostJson, browserPostJson, nativePostJson } from "@/api/post-json";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { request },
}));

describe("activePostJson", () => {
  it("uses browserPostJson off native", () => {
    expect(activePostJson()).toBe(browserPostJson);
  });
});

describe("browserPostJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功返回 status+json", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 201,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await browserPostJson("https://example.com/x", { A: "1" }, { n: 1 });
    expect(r).toEqual({ status: 201, json: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/x",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", A: "1" },
        body: JSON.stringify({ n: 1 }),
      }),
    );
  });

  it("fetch 抛错 → status 0", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await browserPostJson("https://example.com", {}, {})).toEqual({ status: 0, json: {} });
  });

  it("res.json 失败 → json {}", async () => {
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    }));
    expect(await browserPostJson("https://example.com", {}, {})).toEqual({ status: 200, json: {} });
  });
});

describe("nativePostJson", () => {
  afterEach(() => {
    request.mockReset();
  });

  it("CapacitorHttp 成功返回 status+json", async () => {
    request.mockResolvedValueOnce({
      status: 200,
      data: { url: "https://cdn.example/a.wav" },
      headers: {},
      url: "https://example.com",
    });
    const r = await nativePostJson("https://example.com", { Authorization: "Bearer k" }, { text: "hi" });
    expect(r).toEqual({ status: 200, json: { url: "https://cdn.example/a.wav" } });
  });

  it("CapacitorHttp 抛错 → status 0", async () => {
    request.mockRejectedValueOnce(new Error("cors"));
    expect(await nativePostJson("https://example.com", {}, {})).toEqual({ status: 0, json: {} });
  });
});
