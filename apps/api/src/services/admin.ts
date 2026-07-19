import { sql } from "drizzle-orm";
import {
  characterRegionValues,
  type AdminOverviewResponse,
  type AdminUsersQuery,
  type AdminUsersResponse,
} from "@wow-dashboard/api-schema";
import { db } from "../db";
import { isAdminIdentity } from "../lib/adminAccess";

const adminActivityWindowDays = 30;

type CountValue = bigint | number | string;

type OverviewTotalsRow = {
  users: CountValue;
  newUsers: CountValue;
  linkedPlayers: CountValue;
  characters: CountValue;
  snapshots: CountValue;
  addonActiveUsers: CountValue;
  addonIngests: CountValue;
  activeSessionUsers: CountValue;
  activeSessions: CountValue;
};

type ActivityRow = {
  date: string;
  newUsers: CountValue;
  addonIngests: CountValue;
};

type RegionRow = {
  region: (typeof characterRegionValues)[number];
  users: CountValue;
  characters: CountValue;
};

type AddonVersionRow = {
  version: string;
  users: CountValue;
};

type SessionClientRow = {
  client: "web" | "desktop" | "unknown";
  users: CountValue;
  sessions: CountValue;
};

type RecentActivityRow = {
  id: string;
  event: string;
  actorName: string | null;
  occurredAt: Date | string;
  hasError: boolean;
};

type AdminUserRow = {
  id: string;
  name: string;
  role: string | null;
  banned: boolean | null;
  createdAt: Date | string;
  characterCount: CountValue;
  regions: string[] | null;
  lastAddonIngestAt: Date | string | null;
  lastSessionAt: Date | string | null;
  activeSessionCount: CountValue;
};

function toCount(value: CountValue | null | undefined): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

export async function readAdminOverview(): Promise<AdminOverviewResponse> {
  const [totalsRows, activityRows, regionRows, addonVersionRows, sessionClientRows, recentRows] =
    await Promise.all([
      db.execute<OverviewTotalsRow>(sql`
        select
          (select count(*) from "user")::integer as "users",
          (
            select count(*) from "user"
            where "createdAt" >= now() - interval '30 days'
          )::integer as "newUsers",
          (
            select count(*) from "players"
            where "user_id" is not null
          )::integer as "linkedPlayers",
          (select count(*) from "characters")::integer as "characters",
          (select count(*) from "snapshots")::integer as "snapshots",
          (
            select count(distinct "user_id") from "audit_log"
            where "event" = 'addon.ingest'
              and "timestamp" >= now() - interval '30 days'
              and "user_id" is not null
          )::integer as "addonActiveUsers",
          (
            select count(*) from "audit_log"
            where "event" = 'addon.ingest'
              and "timestamp" >= now() - interval '30 days'
          )::integer as "addonIngests",
          (
            select count(distinct "userId") from "session"
            where "expiresAt" > now()
          )::integer as "activeSessionUsers",
          (
            select count(*) from "session"
            where "expiresAt" > now()
          )::integer as "activeSessions"
      `),
      db.execute<ActivityRow>(sql`
        with days as (
          select generate_series(
            date_trunc('day', now()) - interval '29 days',
            date_trunc('day', now()),
            interval '1 day'
          ) as day
        ),
        daily_users as (
          select date_trunc('day', "createdAt") as day, count(*)::integer as count
          from "user"
          where "createdAt" >= date_trunc('day', now()) - interval '29 days'
          group by 1
        ),
        daily_ingests as (
          select date_trunc('day', "timestamp") as day, count(*)::integer as count
          from "audit_log"
          where "event" = 'addon.ingest'
            and "timestamp" >= date_trunc('day', now()) - interval '29 days'
          group by 1
        )
        select
          to_char(days.day, 'YYYY-MM-DD') as "date",
          coalesce(daily_users.count, 0)::integer as "newUsers",
          coalesce(daily_ingests.count, 0)::integer as "addonIngests"
        from days
        left join daily_users on daily_users.day = days.day
        left join daily_ingests on daily_ingests.day = days.day
        order by days.day
      `),
      db.execute<RegionRow>(sql`
        select
          characters.region as "region",
          count(distinct players.user_id)::integer as "users",
          count(characters.id)::integer as "characters"
        from "characters" as characters
        join "players" as players on players.id = characters.player_id
        where players.user_id is not null
        group by characters.region
        order by count(characters.id) desc, characters.region
      `),
      db.execute<AddonVersionRow>(sql`
        with latest_client as (
          select distinct on (players.user_id)
            players.user_id,
            nullif(snapshots.client_info ->> 'addonVersion', '') as addon_version
          from "snapshots" as snapshots
          join "characters" as characters on characters.id = snapshots.character_id
          join "players" as players on players.id = characters.player_id
          where players.user_id is not null
            and snapshots.client_info is not null
          order by players.user_id, snapshots.taken_at desc
        )
        select addon_version as "version", count(*)::integer as "users"
        from latest_client
        where addon_version is not null
        group by addon_version
        order by count(*) desc, addon_version desc
        limit 8
      `),
      db.execute<SessionClientRow>(sql`
        select
          case
            when "userAgent" is null or btrim("userAgent") = '' then 'unknown'
            when lower("userAgent") like '%wow-dashboard-desktop%' then 'desktop'
            else 'web'
          end as "client",
          count(distinct "userId")::integer as "users",
          count(*)::integer as "sessions"
        from "session"
        where "expiresAt" > now()
        group by 1
        order by count(*) desc
      `),
      db.execute<RecentActivityRow>(sql`
        select
          audit.id,
          audit.event,
          coalesce(players.battle_tag, users.name) as "actorName",
          audit.timestamp as "occurredAt",
          (audit.error is not null) as "hasError"
        from "audit_log" as audit
        left join "user" as users on users.id = audit.user_id
        left join "players" as players on players.user_id = audit.user_id
        where audit.event in (
          'auth.user.created',
          'auth.account.created',
          'auth.account.updated',
          'addon.ingest',
          'battlenet.resync',
          'battlenet.resync.unavailable',
          'auth.session.revoked'
        )
        order by audit.timestamp desc
        limit 12
      `),
    ]);

  const totals = totalsRows[0];
  if (!totals) {
    throw new Error("Admin overview totals query returned no rows.");
  }

  const regionRowsByRegion = new Map(regionRows.map((row) => [row.region, row]));

  return {
    generatedAt: new Date().toISOString(),
    windowDays: adminActivityWindowDays,
    totals: {
      users: toCount(totals.users),
      newUsers: toCount(totals.newUsers),
      linkedPlayers: toCount(totals.linkedPlayers),
      characters: toCount(totals.characters),
      snapshots: toCount(totals.snapshots),
      addonActiveUsers: toCount(totals.addonActiveUsers),
      addonIngests: toCount(totals.addonIngests),
      activeSessionUsers: toCount(totals.activeSessionUsers),
      activeSessions: toCount(totals.activeSessions),
    },
    activity: activityRows.map((row) => ({
      date: row.date,
      newUsers: toCount(row.newUsers),
      addonIngests: toCount(row.addonIngests),
    })),
    regions: characterRegionValues.map((region) => {
      const row = regionRowsByRegion.get(region);
      return {
        region,
        users: toCount(row?.users),
        characters: toCount(row?.characters),
      };
    }),
    addonVersions: addonVersionRows.map((row) => ({
      version: row.version,
      users: toCount(row.users),
    })),
    sessionClients: sessionClientRows.map((row) => ({
      client: row.client,
      users: toCount(row.users),
      sessions: toCount(row.sessions),
    })),
    recentActivity: recentRows.map((row) => ({
      id: row.id,
      event: row.event,
      actorName: row.actorName,
      occurredAt: toIsoString(row.occurredAt),
      hasError: row.hasError,
    })),
  };
}

export async function readAdminUsers(input: AdminUsersQuery): Promise<AdminUsersResponse> {
  const countRows = await db.execute<{ total: CountValue }>(sql`
    select count(*)::integer as "total" from "user"
  `);
  const total = toCount(countRows[0]?.total);
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const offset = (page - 1) * input.pageSize;

  const rows = await db.execute<AdminUserRow>(sql`
    with character_stats as (
      select
        players.user_id,
        count(characters.id)::integer as character_count,
        coalesce(
          array_agg(distinct characters.region order by characters.region)
            filter (where characters.region is not null),
          array[]::text[]
        ) as regions
      from "players" as players
      left join "characters" as characters on characters.player_id = players.id
      where players.user_id is not null
      group by players.user_id
    ),
    latest_ingest as (
      select user_id, max(timestamp) as last_addon_ingest_at
      from "audit_log"
      where event = 'addon.ingest' and user_id is not null
      group by user_id
    ),
    session_stats as (
      select
        "userId" as user_id,
        max("updatedAt") as last_session_at,
        count(*) filter (where "expiresAt" > now())::integer as active_session_count
      from "session"
      group by "userId"
    )
    select
      users.id,
      coalesce(players.battle_tag, users.name) as "name",
      users.role,
      users.banned,
      users."createdAt" as "createdAt",
      coalesce(character_stats.character_count, 0)::integer as "characterCount",
      coalesce(character_stats.regions, array[]::text[]) as "regions",
      latest_ingest.last_addon_ingest_at as "lastAddonIngestAt",
      session_stats.last_session_at as "lastSessionAt",
      coalesce(session_stats.active_session_count, 0)::integer as "activeSessionCount"
    from "user" as users
    left join "players" as players on players.user_id = users.id
    left join character_stats on character_stats.user_id = users.id
    left join latest_ingest on latest_ingest.user_id = users.id
    left join session_stats on session_stats.user_id = users.id
    order by greatest(
      users."createdAt",
      coalesce(latest_ingest.last_addon_ingest_at, '-infinity'::timestamptz),
      coalesce(session_stats.last_session_at, '-infinity'::timestamptz)
    ) desc, users.id
    limit ${input.pageSize}
    offset ${offset}
  `);

  const validRegions = new Set<string>(characterRegionValues);

  return {
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: isAdminIdentity(row) ? "admin" : (row.role ?? "user"),
      banned: row.banned ?? false,
      createdAt: toIsoString(row.createdAt),
      characterCount: toCount(row.characterCount),
      regions: (row.regions ?? []).filter(
        (region): region is (typeof characterRegionValues)[number] => validRegions.has(region),
      ),
      lastAddonIngestAt: toNullableIsoString(row.lastAddonIngestAt),
      lastSessionAt: toNullableIsoString(row.lastSessionAt),
      activeSessionCount: toCount(row.activeSessionCount),
    })),
    total,
    page,
    pageSize: input.pageSize,
    totalPages,
  };
}
