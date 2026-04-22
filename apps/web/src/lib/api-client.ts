import { apiQueryKeys, createApiClient, createApiQueryOptions } from "@wow-dashboard/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { env } from "@wow-dashboard/env/web";

const getServerRequestHeaders = createIsomorphicFn()
  .server(async () => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const cookie = getRequestHeader("cookie");
    return cookie ? { cookie } : undefined;
  })
  .client(() => undefined);

export const apiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
  getHeaders: getServerRequestHeaders,
});

export { apiQueryKeys };

export const apiQueryOptions = createApiQueryOptions(apiClient);
