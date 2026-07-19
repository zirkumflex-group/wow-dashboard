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

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    );
import { Toaster } from "@wow-dashboard/ui/components/sonner";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@wow-dashboard/ui/components/sidebar";

import { authClient } from "@/lib/auth-client";
import { getAuthSession } from "@/lib/auth-server";
import { AppSidebar } from "@/components/app-sidebar";

import appCss from "../index.css?url";

const APP_TITLE = "WoW Dashboard";
const AUTH_CACHE_TTL_MS = 60_000;

function getDefaultTitleForPath(pathname: string) {
  if (pathname.startsWith("/dashboard")) return `Dashboard | ${APP_TITLE}`;
  if (pathname.startsWith("/scoreboard")) return `Scoreboard | ${APP_TITLE}`;
  if (pathname.startsWith("/copy-helper")) return `Copy Helper | ${APP_TITLE}`;
  if (pathname.startsWith("/compare")) return `Compare | ${APP_TITLE}`;
  if (pathname.startsWith("/character/")) return `Character | ${APP_TITLE}`;
  if (pathname.startsWith("/players/")) return `Player | ${APP_TITLE}`;
  if (pathname.startsWith("/settings")) return `Settings | ${APP_TITLE}`;
  if (pathname.startsWith("/auth")) return `Sign In | ${APP_TITLE}`;
  return APP_TITLE;
}

type RootAuthState = Awaited<ReturnType<typeof getAuthSession>>;

let cachedAuthState: { sessionData: RootAuthState; fetchedAt: number } | null = null;

async function getCachedAuthState() {
  if (typeof window === "undefined") {
    return await getAuthSession();
  }

  if (cachedAuthState && Date.now() - cachedAuthState.fetchedAt < AUTH_CACHE_TTL_MS) {
    return cachedAuthState.sessionData;
  }

  const sessionData = await getAuthSession();
  cachedAuthState = {
    sessionData,
    fetchedAt: Date.now(),
  };
  return sessionData;
}

interface RouterAppContext {
  queryClient: QueryClient;
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
        name: "description",
        content:
          "A self-hosted World of Warcraft character dashboard for progression, Mythic+, and addon snapshots.",
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
  beforeLoad: async () => {
    const sessionData = await getCachedAuthState();
    return {
      isAuthenticated: sessionData !== null,
      sessionData,
    };
  },
});

function RootDocument() {
  const context = useRouteContext({ from: Route.id });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sessionState = authClient.useSession();
  const noLayout = pathname.startsWith("/auth/electron");
  const sessionData = sessionState.data ?? context.sessionData ?? null;
  const isAuthenticated = sessionData !== null;

  useEffect(() => {
    document.title = getDefaultTitleForPath(pathname);
  }, [pathname]);

  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform focus-visible:translate-y-0 motion-reduce:transition-none"
        >
          Skip to Main Content
        </a>
        {isAuthenticated && !noLayout ? (
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset id="main-content" tabIndex={-1}>
              <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border/70 bg-background/90 px-3 backdrop-blur-md md:hidden">
                <SidebarTrigger className="size-9" />
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-sm border border-primary/35 bg-primary/10 font-mono text-[8px] font-bold text-primary">
                    WD
                  </span>
                  <span className="text-sm font-semibold tracking-tight">WoW Dashboard</span>
                </div>
              </header>
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        ) : (
          <main id="main-content" tabIndex={-1} className="min-h-svh">
            <Outlet />
          </main>
        )}
        <Toaster richColors />
        {import.meta.env.DEV && (
          <div className="fixed bottom-2 right-2 z-[9999] rounded bg-orange-500 px-2 py-0.5 text-xs font-bold text-white select-none pointer-events-none opacity-80">
            DEV
          </div>
        )}
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
