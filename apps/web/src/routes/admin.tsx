import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import type { AdminOverviewResponse, AdminUsersResponse } from "@wow-dashboard/api-schema";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wow-dashboard/ui/components/table";
import { cn } from "@wow-dashboard/ui/lib/utils";
import Activity from "lucide-react/dist/esm/icons/activity.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import type { LucideIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { apiQueryOptions } from "@/lib/api-client";
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format";

const LazyAdminAnalyticsCharts = lazy(() => import("@/components/admin-analytics-charts"));

const DEFAULT_PAGE = 1;
const PAGE_SIZE = 20;
const chartSkeletons = [
  { key: "activity", className: "xl:col-span-8" },
  { key: "regions", className: "xl:col-span-4" },
  { key: "versions", className: "xl:col-span-6" },
  { key: "sessions", className: "xl:col-span-6" },
] as const;

type AdminSearch = {
  page: number;
};

type AdminSearchInput = SearchSchemaInput & Partial<AdminSearch>;

function validateAdminSearch(search: AdminSearchInput): AdminSearch {
  const candidate = typeof search.page === "number" ? search.page : Number(search.page);
  return {
    page:
      Number.isInteger(candidate) && candidate >= 1 ? Math.min(candidate, 100_000) : DEFAULT_PAGE,
  };
}

export const Route = createFileRoute("/admin")({
  validateSearch: validateAdminSearch,
  search: {
    middlewares: [stripSearchParams({ page: DEFAULT_PAGE })],
  },
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: "/" });
    }

    const me = await context.queryClient.ensureQueryData(apiQueryOptions.me());
    if (!me.isAdmin) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(apiQueryOptions.adminOverview()),
      context.queryClient.ensureQueryData(
        apiQueryOptions.adminUsers({ page: deps.page, pageSize: PAGE_SIZE }),
      ),
    ]);
  },
  component: AdminPage,
});

const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE);
const dateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

const activityLabels: Record<string, string> = {
  "auth.user.created": "Account Created",
  "auth.account.created": "Battle.net Linked",
  "auth.account.updated": "Battle.net Refreshed",
  "addon.ingest": "Add-on Data Uploaded",
  "battlenet.resync": "Character Sync Requested",
  "battlenet.resync.unavailable": "Character Sync Unavailable",
  "auth.session.revoked": "Session Revoked",
};

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function AdminMetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="analytics-panel h-full overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            <h2>{label}</h2>
          </CardTitle>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Icon aria-hidden={true} className="size-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="analytics-number font-mono text-3xl font-semibold tabular-nums">
          {numberFormatter.format(value)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function AdminChartsSkeleton() {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-12" aria-label="Loading analytics charts">
      {chartSkeletons.map((chart) => (
        <Card key={chart.key} className={`analytics-panel min-w-0 ${chart.className}`}>
          <CardHeader>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[19rem] w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecentActivity({ activity }: { activity: AdminOverviewResponse["recentActivity"] }) {
  return (
    <Card className="analytics-panel h-full">
      <CardHeader className="border-b border-border/70">
        <CardTitle className="text-base">
          <h2>Recent Account Activity</h2>
        </CardTitle>
        <CardDescription>
          Security and data-ingest events without sensitive metadata.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {activity.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No account activity has been recorded yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {activity.map((event) => (
              <li
                key={event.id}
                className="flex min-w-0 items-start gap-3 rounded-md px-2 py-3 hover:bg-muted/35"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    event.hasError ? "bg-destructive" : "bg-primary",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-medium">
                      {activityLabels[event.event] ?? event.event.replaceAll(".", " ")}
                    </p>
                    {event.hasError ? <Badge variant="destructive">Failed</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {event.actorName ?? "System"}
                  </p>
                </div>
                <time
                  dateTime={event.occurredAt}
                  className="shrink-0 text-right text-xs text-muted-foreground"
                >
                  {formatDateTime(event.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function UserDirectory({ data }: { data: AdminUsersResponse }) {
  const hasPreviousPage = data.page > 1;
  const hasNextPage = data.page < data.totalPages;

  return (
    <Card className="analytics-panel min-w-0 overflow-hidden">
      <CardHeader className="border-b border-border/70 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">
            <h2>User Directory</h2>
          </CardTitle>
          <CardDescription className="mt-1">
            BattleTag, account age, game regions, characters, and known activity. Emails and IP
            addresses are intentionally omitted.
          </CardDescription>
        </div>
        <Badge variant="outline" className="w-fit tabular-nums">
          {numberFormatter.format(data.total)} users
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableCaption className="sr-only">
            Paginated administrator-only account directory
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Characters</TableHead>
              <TableHead>Regions</TableHead>
              <TableHead>Last Add-on Ingest</TableHead>
              <TableHead>Last Auth Session</TableHead>
              <TableHead className="text-right">Active Sessions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  No users were returned for this page.
                </TableCell>
              </TableRow>
            ) : (
              data.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="min-w-48">
                    <p className="max-w-64 truncate font-medium">{user.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Joined {formatDate(user.createdAt)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.banned
                          ? "destructive"
                          : user.role === "admin"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {user.banned ? "Banned" : user.role === "admin" ? "Admin" : "User"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {numberFormatter.format(user.characterCount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-24 flex-wrap gap-1">
                      {user.regions.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        user.regions.map((region) => (
                          <Badge key={region} variant="outline">
                            {region.toLocaleUpperCase("en-US")}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <time dateTime={user.lastAddonIngestAt ?? undefined}>
                      {formatDate(user.lastAddonIngestAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <time dateTime={user.lastSessionAt ?? undefined}>
                      {formatDate(user.lastSessionAt)}
                    </time>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {numberFormatter.format(user.activeSessionCount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      <div className="flex flex-col gap-3 border-t border-border/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          Page {data.page} of {data.totalPages}
        </p>
        <nav className="flex items-center gap-2" aria-label="User directory pagination">
          {hasPreviousPage ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin" search={{ page: data.page - 1 }}>
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>
          )}
          {hasNextPage ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin" search={{ page: data.page + 1 }}>
                Next
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </nav>
      </div>
    </Card>
  );
}

function AdminPage() {
  const search = Route.useSearch();
  const overviewQuery = useQuery(apiQueryOptions.adminOverview());
  const usersQuery = useQuery(
    apiQueryOptions.adminUsers({ page: search.page, pageSize: PAGE_SIZE }),
  );
  const overview = overviewQuery.data;
  const users = usersQuery.data;

  if (!overview || !users) {
    return (
      <div className="analytics-shell w-full px-4 py-6 sm:px-6 lg:px-8">
        <AdminChartsSkeleton />
      </div>
    );
  }

  return (
    <div className="analytics-shell mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="analytics-kicker text-primary">Administration / Product Signals</p>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck aria-hidden="true" className="size-3" />
              Admin Only
            </Badge>
            <Badge variant="secondary">Read Only</Badge>
          </div>
          <h1 className="mt-2 text-pretty text-3xl font-bold tracking-tight sm:text-4xl">
            User &amp; Add-on Overview
          </h1>
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Account growth, add-on adoption, WoW regions, authenticated clients, and recent system
            activity from data the dashboard already collects.
          </p>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          Generated{" "}
          <time dateTime={overview.generatedAt}>{formatDateTime(overview.generatedAt)}</time>
        </p>
      </header>

      <section aria-labelledby="admin-summary-heading">
        <h2 id="admin-summary-heading" className="sr-only">
          Account Summary
        </h2>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <AdminMetricCard
            label="Total Users"
            value={overview.totals.users}
            detail={`${numberFormatter.format(overview.totals.newUsers)} joined during the last ${overview.windowDays} days`}
            icon={Users}
          />
          <AdminMetricCard
            label="Active Add-on Users"
            value={overview.totals.addonActiveUsers}
            detail={`${numberFormatter.format(overview.totals.addonIngests)} successful ingests during the last ${overview.windowDays} days`}
            icon={Upload}
          />
          <AdminMetricCard
            label="Tracked Characters"
            value={overview.totals.characters}
            detail={`${numberFormatter.format(overview.totals.linkedPlayers)} linked players · ${numberFormatter.format(overview.totals.snapshots)} snapshots`}
            icon={Database}
          />
          <AdminMetricCard
            label="Authenticated Users"
            value={overview.totals.activeSessionUsers}
            detail={`${numberFormatter.format(overview.totals.activeSessions)} currently valid browser or desktop sessions`}
            icon={Activity}
          />
        </div>
      </section>

      <Suspense fallback={<AdminChartsSkeleton />}>
        <LazyAdminAnalyticsCharts overview={overview} />
      </Suspense>

      <RecentActivity activity={overview.recentActivity} />
      <UserDirectory data={users} />
    </div>
  );
}
