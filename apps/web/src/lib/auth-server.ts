import { getToken as getConvexBetterAuthToken } from "@convex-dev/better-auth/utils";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";
import React from "react";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { getPublicRuntimeEnv } from "@/lib/runtime-env";

const cache = React.cache ?? ((fn: typeof getCachedToken) => fn);

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
];

const PROXY_HEADER_PREFIXES = [
  "cf-",
  "x-forwarded-",
  "x-real-",
  "x-vercel-",
  "x-nf-",
];

const PROXY_HEADERS = [
  "fastly-client-ip",
  "forwarded",
  "true-client-ip",
];

function shouldStripHeader(name: string) {
  const lower = name.toLowerCase();
  return (
    HOP_BY_HOP_HEADERS.includes(lower) ||
    PROXY_HEADERS.includes(lower) ||
    PROXY_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

function sanitizeHeaders(input: HeadersInit | Headers) {
  const headers = new Headers(input);
  for (const key of [...headers.keys()]) {
    if (shouldStripHeader(key)) {
      headers.delete(key);
    }
  }
  return headers;
}

function getAuthConfig() {
  const runtimeEnv = getPublicRuntimeEnv();
  return {
    convexSiteUrl: runtimeEnv.VITE_CONVEX_SITE_URL,
    convexUrl: runtimeEnv.VITE_CONVEX_URL,
  };
}

async function getCachedToken() {
  const headers = sanitizeHeaders(getRequestHeaders());
  return getConvexBetterAuthToken(getAuthConfig().convexSiteUrl, headers);
}

const cachedGetToken = cache(getCachedToken);

export async function getToken() {
  const token = await cachedGetToken();
  return token?.token;
}

export async function handler(request: Request) {
  const { convexSiteUrl } = getAuthConfig();
  const requestUrl = new URL(request.url);
  const nextUrl = `${convexSiteUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = sanitizeHeaders(request.headers);
  headers.set("host", new URL(convexSiteUrl).host);

  const init: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    body: request.body,
    // Required for streaming request bodies in Node fetch.
    duplex: "half",
  };

  return fetch(nextUrl, init);
}

function setupClient(token?: string) {
  const client = new ConvexHttpClient(getAuthConfig().convexUrl);
  if (token !== undefined) {
    client.setAuth(token);
  }
  // @ts-expect-error internal convex client option
  client.setFetchOptions({ cache: "no-store" });
  return client;
}

async function withToken<T>(fn: (token: string | undefined) => Promise<T>) {
  const token = await cachedGetToken();
  return fn(token?.token);
}

export async function fetchAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): Promise<FunctionReturnType<Query>> {
  return withToken(
    (token) => (setupClient(token) as any).query(query, ...(args as any)),
  ) as Promise<FunctionReturnType<Query>>;
}

export async function fetchAuthMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  ...args: OptionalRestArgs<Mutation>
): Promise<FunctionReturnType<Mutation>> {
  return withToken(
    (token) => (setupClient(token) as any).mutation(mutation, ...(args as any)),
  ) as Promise<FunctionReturnType<Mutation>>;
}

export async function fetchAuthAction<Action extends FunctionReference<"action">>(
  action: Action,
  ...args: OptionalRestArgs<Action>
): Promise<FunctionReturnType<Action>> {
  return withToken(
    (token) => (setupClient(token) as any).action(action, ...(args as any)),
  ) as Promise<FunctionReturnType<Action>>;
}
