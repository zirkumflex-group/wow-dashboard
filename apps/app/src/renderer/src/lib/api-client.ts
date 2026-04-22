import { apiQueryKeys, createApiClient, createApiQueryOptions } from "@wow-dashboard/api-client";
import { env } from "@wow-dashboard/env/app";

export const apiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
  getAccessToken: () => window.electron.auth.getToken(),
});

export { apiQueryKeys };

export const apiQueryOptions = createApiQueryOptions(apiClient);
