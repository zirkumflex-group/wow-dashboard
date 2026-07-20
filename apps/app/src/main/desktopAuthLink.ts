const desktopAuthProtocol = "wow-dashboard:";
const desktopAuthHost = "auth";
const loginCodePattern = /^[a-f0-9]{64}$/i;

export function readDesktopAuthCode(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== desktopAuthProtocol || url.hostname !== desktopAuthHost) return null;

    const code = url.searchParams.get("code")?.trim() ?? "";
    return loginCodePattern.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function findDesktopAuthDeepLink(argv: readonly string[]): string | null {
  return argv.find((argument) => readDesktopAuthCode(argument) !== null) ?? null;
}
