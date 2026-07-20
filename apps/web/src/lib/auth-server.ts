import { ApiClientError, createApiClient } from "@wow-dashboard/api-client";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { env } from "@wow-dashboard/env/web";

import { forwardApiResponseCookies } from "@/lib/api-response-cookies";

type AuthSessionResponse = Awaited<ReturnType<ReturnType<typeof createApiClient>["getMe"]>>;

export const getAuthSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthSessionResponse | null> => {
    const cookie = getRequestHeader("cookie");
    const apiClient = createApiClient({
      baseUrl: env.VITE_API_URL,
      getHeaders: () => (cookie ? { cookie } : undefined),
      onResponse: forwardApiResponseCookies,
    });

    try {
      return await apiClient.getMe();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        return null;
      }

      throw error;
    }
  },
);
