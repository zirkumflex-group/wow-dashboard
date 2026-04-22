import { createAuthClient } from "better-auth/react";
import { env } from "@wow-dashboard/env/web";

function getAuthBaseUrl(apiUrl: string) {
  const url = new URL(apiUrl);
  url.pathname = url.pathname.replace(/\/api\/?$/, "");
  return url.toString().replace(/\/$/, "");
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(env.VITE_API_URL),
  credentials: "include",
});
