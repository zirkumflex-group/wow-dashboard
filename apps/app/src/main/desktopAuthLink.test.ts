import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findDesktopAuthDeepLink, readDesktopAuthCode } from "./desktopAuthLink";

const loginCode = "a".repeat(64);

describe("desktop authentication deep links", () => {
  it("accepts the registered auth URL and reads its one-time code", () => {
    assert.equal(readDesktopAuthCode(`wow-dashboard://auth?code=${loginCode}`), loginCode);
  });

  it("rejects other protocols, hosts, malformed URLs, and malformed codes", () => {
    assert.equal(readDesktopAuthCode(`https://auth?code=${loginCode}`), null);
    assert.equal(readDesktopAuthCode(`wow-dashboard://settings?code=${loginCode}`), null);
    assert.equal(readDesktopAuthCode("not a URL"), null);
    assert.equal(readDesktopAuthCode("wow-dashboard://auth?code=short"), null);
  });

  it("finds a valid deep link in the initial process arguments", () => {
    const link = `wow-dashboard://auth?code=${loginCode}`;
    assert.equal(findDesktopAuthDeepLink(["WoW Dashboard.exe", "--flag", link]), link);
    assert.equal(findDesktopAuthDeepLink(["WoW Dashboard.exe", "--flag"]), null);
  });
});
