import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    );
import { Toaster } from "@wow-dashboard/ui/components/sonner";
import { SidebarInset, SidebarProvider } from "@wow-dashboard/ui/components/sidebar";

import { authClient } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, THEME_SCRIPT } from "@/components/theme-provider";

import appCss from "../index.css?url";

const APP_TITLE = "WoW Dashboard";
const AUTH_CACHE_TTL_MS = 60_000;

function getDefaultTitleForPath(pathname: string) {
  if (pathname.startsWith("/dashboard")) return `Dashboard | ${APP_TITLE}`;
  if (pathname.startsWith("/scoreboard")) return `Scoreboard | ${APP_TITLE}`;
  if (pathname.startsWith("/compare")) return `Compare | ${APP_TITLE}`;
  if (pathname.startsWith("/character/")) return `Character | ${APP_TITLE}`;
  if (pathname.startsWith("/players/")) return `Player | ${APP_TITLE}`;
  if (pathname.startsWith("/settings")) return `Settings | ${APP_TITLE}`;
  if (pathname.startsWith("/auth")) return `Sign In | ${APP_TITLE}`;
  return APP_TITLE;
}

const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken();
});

let cachedAuthState: { token: string | null; fetchedAt: number } | null = null;

async function getCachedAuthToken() {
  if (typeof window === "undefined") {
    return await getAuth();
  }

  if (
    cachedAuthState &&
    Date.now() - cachedAuthState.fetchedAt < AUTH_CACHE_TTL_MS
  ) {
    return cachedAuthState.token;
  }

  const token = await getAuth();
  cachedAuthState = {
    token: token ?? null,
    fetchedAt: Date.now(),
  };
  return token;
}

export interface RouterAppContext {
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "theme-color",
        content: "#050505",
      },
      {
        title: APP_TITLE,
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "any",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    ],
  }),

  component: RootDocument,
  beforeLoad: async (ctx) => {
    const token = await getCachedAuthToken();
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return {
      isAuthenticated: !!token,
      token,
    };
  },
});

function RootDocument() {
  const context = useRouteContext({ from: Route.id });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const noLayout = pathname.startsWith("/auth/electron");

  useEffect(() => {
    document.title = getDefaultTitleForPath(pathname);
  }, [pathname]);

  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      authClient={authClient}
      initialToken={context.token}
    >
      <html lang="en">
        <head>
          <HeadContent />
          {/* Inline script runs before first paint to avoid theme flash */}
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body>
          <ThemeProvider>
            {context.isAuthenticated && !noLayout ? (
              <SidebarProvider>
                <AppSidebar />
                <SidebarInset>
                  <Outlet />
                </SidebarInset>
              </SidebarProvider>
            ) : (
              <div className="h-svh">
                <Outlet />
              </div>
            )}
            <Toaster richColors />
            {import.meta.env.DEV && (
              <div className="fixed bottom-2 right-2 z-[9999] rounded bg-orange-500 px-2 py-0.5 text-xs font-bold text-white select-none pointer-events-none opacity-80">
                DEV
              </div>
            )}
          </ThemeProvider>
          <TanStackRouterDevtools position="bottom-left" />
          <Scripts />
        </body>
      </html>
    </ConvexBetterAuthProvider>
  );
}
