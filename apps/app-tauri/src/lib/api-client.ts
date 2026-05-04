import { apiQueryKeys, createApiClient, createApiQueryOptions } from "@wow-dashboard/api-client";
import { env } from "@wow-dashboard/env/app";
import { desktop } from "./desktop";

async function tauriApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = request?.url ?? String(input);
  const method = init?.method ?? request?.method ?? "GET";
  const headers = new Headers(request?.headers);

  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  let body: string | undefined;
  const requestBody = init?.body;
  if (typeof requestBody === "string") {
    body = requestBody;
  } else if (requestBody !== undefined && requestBody !== null) {
    body = await new Response(requestBody).text();
  } else if (request && method.toUpperCase() !== "GET") {
    body = await request.text();
  }

  const response = await desktop.api.fetch({
    url,
    method,
    headers: Array.from(headers.entries()),
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const apiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
  credentials: "omit",
  fetch: tauriApiFetch,
});

export { apiQueryKeys };

export const apiQueryOptions = createApiQueryOptions(apiClient);
