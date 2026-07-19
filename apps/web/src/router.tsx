import { QueryClient } from "@tanstack/react-query";
import {
  Link,
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";

import Loader from "./components/loader";

import "./index.css";
import { routeTree } from "./routeTree.gen";

function NotFoundPage() {
  return (
    <div className="flex min-h-[70svh] items-center justify-center px-4 py-12">
      <Card className="analytics-panel w-full max-w-lg">
        <CardHeader>
          <p className="analytics-kicker">404 / Route Missing</p>
          <CardTitle className="text-2xl">That Page Is Not Tracked</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The link may be outdated, private, or no longer available.
          </p>
          <Button asChild className="self-start">
            <Link to="/dashboard">Open Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RouterError({ error, reset }: ErrorComponentProps) {
  const developmentDetails = import.meta.env.DEV && error instanceof Error ? error.message : null;

  return (
    <div className="flex min-h-[70svh] items-center justify-center px-4 py-12">
      <Card className="analytics-panel w-full max-w-lg border-destructive/40">
        <CardHeader>
          <p className="analytics-kicker text-destructive">Request Failed</p>
          <CardTitle className="text-2xl">This View Could Not Be Loaded</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The request failed before the page could finish loading. Try again, or return to the
            dashboard.
          </p>
          {developmentDetails ? (
            <pre className="max-h-32 overflow-auto rounded border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {developmentDetails}
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try Again</Button>
            <Button variant="outline" asChild>
              <Link to="/dashboard">Return to Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function getRouter() {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 2,
        refetchOnWindowFocus: true,
      },
    },
  });

  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouterError,
    context: { queryClient },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
