import { createIsomorphicFn } from "@tanstack/react-start";

function readSetCookieHeaders(headers: unknown) {
  const normalizedHeaders = headers as {
    get: (name: string) => string | null;
    getSetCookie?: () => string[];
  };
  const getSetCookie = normalizedHeaders.getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(normalizedHeaders);
  }

  const combinedHeader = normalizedHeaders.get("set-cookie");
  return combinedHeader ? [combinedHeader] : [];
}

export const forwardApiResponseCookies = createIsomorphicFn()
  .server(async (response: Response) => {
    const refreshedCookies = readSetCookieHeaders(response.headers);
    if (refreshedCookies.length === 0) return;

    const { getResponseHeaders } = await import("@tanstack/react-start/server");
    const responseHeaders = getResponseHeaders();
    const existingCookies = new Set(readSetCookieHeaders(responseHeaders));
    for (const refreshedCookie of refreshedCookies) {
      if (!existingCookies.has(refreshedCookie)) {
        responseHeaders.append("set-cookie", refreshedCookie);
        existingCookies.add(refreshedCookie);
      }
    }
  })
  .client((_response: Response) => undefined);
