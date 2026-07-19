import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDesktopConfig } from "../shared/config";

describe("desktop config", () => {
  it("uses local development defaults when Vite URLs are absent", () => {
    assert.deepEqual(resolveDesktopConfig({}), {
      apiUrl: "http://localhost:3000/api",
      siteUrl: "http://localhost:3001",
    });
  });

  it("accepts configured HTTP endpoints and rejects other protocols", () => {
    assert.deepEqual(
      resolveDesktopConfig({
        VITE_API_URL: "https://dashboard.example/api",
        VITE_SITE_URL: "https://dashboard.example",
      }),
      {
        apiUrl: "https://dashboard.example/api",
        siteUrl: "https://dashboard.example",
      },
    );
    assert.throws(
      () => resolveDesktopConfig({ VITE_API_URL: "file:///tmp/api" }),
      /must use http or https/,
    );
  });
});
