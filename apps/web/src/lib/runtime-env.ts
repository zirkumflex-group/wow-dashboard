import { env } from "@wow-dashboard/env/web";

export interface PublicRuntimeEnv {
  VITE_CONVEX_URL: string;
  VITE_CONVEX_SITE_URL: string;
}

declare global {
  var __WOW_DASHBOARD_ENV__: PublicRuntimeEnv | undefined;

  interface Window {
    __WOW_DASHBOARD_ENV__?: PublicRuntimeEnv;
  }
}

function readServerRuntimeEnv(): PublicRuntimeEnv {
  return {
    VITE_CONVEX_URL: process.env.VITE_CONVEX_URL ?? env.VITE_CONVEX_URL,
    VITE_CONVEX_SITE_URL: process.env.VITE_CONVEX_SITE_URL ?? env.VITE_CONVEX_SITE_URL,
  };
}

export function getPublicRuntimeEnv(): PublicRuntimeEnv {
  if (typeof window === "undefined") {
    return readServerRuntimeEnv();
  }

  return window.__WOW_DASHBOARD_ENV__ ?? env;
}

export function getPublicRuntimeEnvScript(): string {
  return `window.__WOW_DASHBOARD_ENV__=${JSON.stringify(readServerRuntimeEnv())};`;
}
