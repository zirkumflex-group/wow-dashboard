const ADDON_VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const SHA256_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/i;
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export interface AddonReleaseInfo {
  url: string;
  checksumUrl: string;
  version: string;
  archiveSize: number;
  checksumSize: number;
  archiveDigest: string | null;
}

export interface StagedAddonUpdate {
  version: string;
  checksumUrl: string;
  downloadedAt: number;
  archiveDigest: string | null;
}

type ReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
  size: number;
  digest: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidAddonVersion(version: string): boolean {
  return ADDON_VERSION_PATTERN.test(version);
}

export function compareVersionStrings(left: string, right: string): number {
  if (!isValidAddonVersion(left) || !isValidAddonVersion(right)) {
    return left.localeCompare(right);
  }

  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function parseAddonReleaseTags(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub matching references response was not an array");
  }

  const tags = new Set<string>();
  for (const value of payload) {
    if (!isRecord(value) || typeof value.ref !== "string") continue;
    const match = /^refs\/tags\/addon-v(.+)$/.exec(value.ref);
    if (match?.[1] && isValidAddonVersion(match[1])) {
      tags.add(`addon-v${match[1]}`);
    }
  }
  return [...tags].sort((left, right) =>
    compareVersionStrings(right.replace("addon-v", ""), left.replace("addon-v", "")),
  );
}

function repositoryParts(repository: string): [string, string] {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid GitHub repository configuration");
  }
  return [parts[0], parts[1]];
}

export function validateOfficialAddonReleaseUrl(
  url: string,
  repository: string,
  tagName: string,
  assetName: string,
): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid addon release asset URL");
  }

  const [repoOwner, repoName] = repositoryParts(repository);
  const pathSegments = parsedUrl.pathname.split("/").map((segment) => decodeURIComponent(segment));
  const expectedSegments = ["", repoOwner, repoName, "releases", "download", tagName, assetName];
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.port !== "" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== "" ||
    pathSegments.length !== expectedSegments.length ||
    pathSegments.some((segment, index) => segment !== expectedSegments[index])
  ) {
    throw new Error(`Untrusted addon release asset URL: ${url}`);
  }
}

export function validateAddonDownloadRedirect(url: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid addon download redirect URL");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !TRUSTED_DOWNLOAD_HOSTS.has(parsedUrl.hostname) ||
    (parsedUrl.port !== "" && parsedUrl.port !== "443") ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== ""
  ) {
    throw new Error(`Untrusted addon download redirect: ${url}`);
  }
}

function parseReleaseAsset(value: unknown, assetName: string): ReleaseAsset | null {
  if (!isRecord(value) || value.name !== assetName) return null;
  if (
    typeof value.browser_download_url !== "string" ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.state !== "uploaded"
  ) {
    throw new Error(`Invalid ${assetName} release asset metadata`);
  }

  let digest: string | null = null;
  if (value.digest !== null && value.digest !== undefined) {
    if (typeof value.digest !== "string" || !SHA256_DIGEST_PATTERN.test(value.digest)) {
      throw new Error(`Invalid ${assetName} release asset digest`);
    }
    digest = value.digest.toLowerCase();
  }

  return {
    name: assetName,
    browserDownloadUrl: value.browser_download_url,
    size: value.size,
    digest,
  };
}

export function parseLatestAddonRelease(
  payload: unknown,
  repository: string,
  limits: { archiveBytes: number; checksumBytes: number },
): AddonReleaseInfo {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response was not an array");
  }

  let latest: { version: string; tagName: string; assets: unknown[] } | undefined;

  for (const value of payload) {
    if (!isRecord(value) || typeof value.tag_name !== "string") continue;
    if (value.draft === true || value.prerelease === true) continue;

    const tagMatch = /^addon-v(.+)$/.exec(value.tag_name);
    if (!tagMatch?.[1] || !isValidAddonVersion(tagMatch[1])) continue;
    if (!Array.isArray(value.assets)) {
      throw new Error(`Addon release ${value.tag_name} has invalid asset metadata`);
    }

    if (!latest || compareVersionStrings(tagMatch[1], latest.version) > 0) {
      latest = {
        version: tagMatch[1],
        tagName: value.tag_name,
        assets: value.assets,
      };
    }
  }

  if (!latest) throw new Error("No valid addon release found on GitHub");
  const archiveAssets = latest.assets
    .map((asset) => parseReleaseAsset(asset, "wow-dashboard.zip"))
    .filter((asset): asset is ReleaseAsset => asset !== null);
  const checksumAssets = latest.assets
    .map((asset) => parseReleaseAsset(asset, "wow-dashboard.zip.sha256"))
    .filter((asset): asset is ReleaseAsset => asset !== null);
  if (archiveAssets.length !== 1 || checksumAssets.length !== 1) {
    throw new Error(`Addon release ${latest.tagName} must contain one archive and one checksum`);
  }

  const archive = archiveAssets[0];
  const checksum = checksumAssets[0];
  if (!archive || !checksum) throw new Error(`Addon release ${latest.tagName} is incomplete`);
  if (archive.size > limits.archiveBytes) {
    throw new Error(`Addon archive exceeds the ${limits.archiveBytes}-byte size limit`);
  }
  if (checksum.size > limits.checksumBytes) {
    throw new Error(`Addon checksum exceeds the ${limits.checksumBytes}-byte size limit`);
  }

  validateOfficialAddonReleaseUrl(
    archive.browserDownloadUrl,
    repository,
    latest.tagName,
    archive.name,
  );
  validateOfficialAddonReleaseUrl(
    checksum.browserDownloadUrl,
    repository,
    latest.tagName,
    checksum.name,
  );

  return {
    url: archive.browserDownloadUrl,
    checksumUrl: checksum.browserDownloadUrl,
    version: latest.version,
    archiveSize: archive.size,
    checksumSize: checksum.size,
    archiveDigest: archive.digest,
  };
}

export function parseStagedAddonUpdate(
  value: unknown,
  repository: string,
): StagedAddonUpdate | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.version !== "string" ||
    !isValidAddonVersion(value.version) ||
    typeof value.checksumUrl !== "string" ||
    typeof value.downloadedAt !== "number" ||
    !Number.isSafeInteger(value.downloadedAt) ||
    value.downloadedAt <= 0
  ) {
    return null;
  }

  let archiveDigest: string | null = null;
  if (value.archiveDigest !== null && value.archiveDigest !== undefined) {
    if (
      typeof value.archiveDigest !== "string" ||
      !SHA256_DIGEST_PATTERN.test(value.archiveDigest)
    ) {
      return null;
    }
    archiveDigest = value.archiveDigest.toLowerCase();
  }

  try {
    validateOfficialAddonReleaseUrl(
      value.checksumUrl,
      repository,
      `addon-v${value.version}`,
      "wow-dashboard.zip.sha256",
    );
  } catch {
    return null;
  }

  return {
    version: value.version,
    checksumUrl: value.checksumUrl,
    downloadedAt: value.downloadedAt,
    archiveDigest,
  };
}

export function parseAddonTocManifest(content: string, expectedVersion: string): string[] {
  if (!isValidAddonVersion(expectedVersion)) {
    throw new Error(`Invalid expected addon version: ${expectedVersion}`);
  }

  const versionMatch = /^##\s*Version:\s*(.+)$/m.exec(content);
  const actualVersion = versionMatch?.[1]?.trim();
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Addon archive version ${actualVersion ?? "<missing>"} does not match release ${expectedVersion}`,
    );
  }

  const files: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (
      normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`Unsafe addon file path in TOC: ${line}`);
    }
    files.push(normalized);
  }

  if (!files.includes("wow-dashboard.lua")) {
    throw new Error("Addon TOC does not load wow-dashboard.lua");
  }
  return [...new Set(files)];
}
