const defaultApiUrl = "http://localhost:3000/api";
const defaultSiteUrl = "http://localhost:3001";

function readHttpUrl(value: string | undefined, fallback: string, variableName: string): string {
  const candidate = value?.trim() || fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${variableName} must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${variableName} must use http or https`);
  }

  return candidate;
}

export function resolveDesktopConfig(runtimeEnv: Record<string, string | undefined>) {
  return Object.freeze({
    apiUrl: readHttpUrl(runtimeEnv["VITE_API_URL"], defaultApiUrl, "VITE_API_URL"),
    siteUrl: readHttpUrl(runtimeEnv["VITE_SITE_URL"], defaultSiteUrl, "VITE_SITE_URL"),
  });
}

const runtimeEnv =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const desktopConfig = resolveDesktopConfig(runtimeEnv);
