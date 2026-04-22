import { createApiClient, createApiQueryOptions } from "@wow-dashboard/api-client";
import { env } from "@wow-dashboard/env/web";

export const apiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
});

export const apiQueryOptions = createApiQueryOptions(apiClient);
