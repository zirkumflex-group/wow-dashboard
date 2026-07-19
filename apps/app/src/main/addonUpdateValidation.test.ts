import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareVersionStrings,
  parseAddonTocManifest,
  parseAddonReleaseTags,
  parseLatestAddonRelease,
  parseStagedAddonUpdate,
  validateAddonDownloadRedirect,
} from "./addonUpdateValidation";

const repository = "zirkumflex-group/wow-dashboard";

function asset(name: string, size: number, digest: string | null = null) {
  return {
    name,
    state: "uploaded",
    size,
    digest,
    browser_download_url: `https://github.com/${repository}/releases/download/addon-v1.2.3/${name}`,
  };
}

describe("addon update validation", () => {
  it("compares bounded semantic versions numerically", () => {
    assert.equal(compareVersionStrings("1.10.0", "1.9.99"), 1);
    assert.equal(compareVersionStrings("2.0.0", "2.0.0"), 0);
    assert.equal(compareVersionStrings("1.0.0", "1.0.1"), -1);
  });

  it("sorts only valid addon release tags", () => {
    assert.deepEqual(
      parseAddonReleaseTags([
        { ref: "refs/tags/addon-v1.9.0" },
        { ref: "refs/tags/app-v99.0.0" },
        { ref: "refs/tags/addon-v1.10.0" },
        { ref: "refs/tags/addon-v1.10.0-beta" },
      ]),
      ["addon-v1.10.0", "addon-v1.9.0"],
    );
  });

  it("selects the highest complete stable addon release", () => {
    const older = {
      tag_name: "addon-v1.2.2",
      draft: false,
      prerelease: false,
      assets: [
        {
          ...asset("wow-dashboard.zip", 100),
          browser_download_url: `https://github.com/${repository}/releases/download/addon-v1.2.2/wow-dashboard.zip`,
        },
        {
          ...asset("wow-dashboard.zip.sha256", 80),
          browser_download_url: `https://github.com/${repository}/releases/download/addon-v1.2.2/wow-dashboard.zip.sha256`,
        },
      ],
    };
    const latest = {
      tag_name: "addon-v1.2.3",
      draft: false,
      prerelease: false,
      assets: [
        asset("wow-dashboard.zip", 120, `sha256:${"a".repeat(64)}`),
        asset("wow-dashboard.zip.sha256", 80),
      ],
    };

    assert.deepEqual(
      parseLatestAddonRelease([latest, older], repository, {
        archiveBytes: 1_000,
        checksumBytes: 1_000,
      }),
      {
        version: "1.2.3",
        url: `https://github.com/${repository}/releases/download/addon-v1.2.3/wow-dashboard.zip`,
        checksumUrl: `https://github.com/${repository}/releases/download/addon-v1.2.3/wow-dashboard.zip.sha256`,
        archiveSize: 120,
        checksumSize: 80,
        archiveDigest: `sha256:${"a".repeat(64)}`,
      },
    );
  });

  it("rejects oversized or ambiguous release assets", () => {
    const release = {
      tag_name: "addon-v1.2.3",
      draft: false,
      prerelease: false,
      assets: [asset("wow-dashboard.zip", 2_000), asset("wow-dashboard.zip.sha256", 80)],
    };
    assert.throws(
      () =>
        parseLatestAddonRelease([release], repository, {
          archiveBytes: 1_000,
          checksumBytes: 1_000,
        }),
      /size limit/,
    );

    release.assets.push(asset("wow-dashboard.zip", 100));
    assert.throws(
      () =>
        parseLatestAddonRelease([release], repository, {
          archiveBytes: 10_000,
          checksumBytes: 1_000,
        }),
      /one archive and one checksum/,
    );
  });

  it("accepts only official staged metadata", () => {
    const value = {
      version: "1.2.3",
      checksumUrl: `https://github.com/${repository}/releases/download/addon-v1.2.3/wow-dashboard.zip.sha256`,
      downloadedAt: 123,
      archiveDigest: null,
    };
    assert.deepEqual(parseStagedAddonUpdate(value, repository), value);
    assert.equal(
      parseStagedAddonUpdate({ ...value, checksumUrl: "https://example.com/checksum" }, repository),
      null,
    );
    assert.equal(parseStagedAddonUpdate({ ...value, version: "1.2" }, repository), null);
  });

  it("validates archive version and every TOC path", () => {
    assert.deepEqual(
      parseAddonTocManifest("## Version: 1.2.3\nwow-dashboard.lua\nui\\panel.lua", "1.2.3"),
      ["wow-dashboard.lua", "ui/panel.lua"],
    );
    assert.throws(
      () => parseAddonTocManifest("## Version: 1.2.2\nwow-dashboard.lua", "1.2.3"),
      /does not match/,
    );
    assert.throws(
      () => parseAddonTocManifest("## Version: 1.2.3\n../evil.lua", "1.2.3"),
      /Unsafe addon file path/,
    );
  });

  it("allows only HTTPS GitHub asset redirect hosts", () => {
    assert.doesNotThrow(() =>
      validateAddonDownloadRedirect("https://release-assets.githubusercontent.com/file?token=x"),
    );
    assert.throws(() => validateAddonDownloadRedirect("https://example.com/file"), /Untrusted/);
    assert.throws(
      () => validateAddonDownloadRedirect("http://release-assets.githubusercontent.com/file"),
      /Untrusted/,
    );
  });
});
