import { v } from "convex/values";

import { httpAction, internalMutation, mutation } from "./_generated/server";
import { authComponent } from "./auth";
import { internal } from "./_generated/api";

// How long a login code is valid (milliseconds).
const CODE_TTL_MS = 60_000; // 60 seconds

// Expose the mutation for public use (requires a valid Convex auth token from the web session).
export const storeLoginCode = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");
    if (!token) throw new Error("Token is required");

    // Generate a 32-byte random hex code (256-bit entropy).
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const code = Array.from(array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await ctx.db.insert("loginCodes", {
      code,
      token,
      expiresAt: Date.now() + CODE_TTL_MS,
      used: false,
    });

    await ctx.runMutation(internal.audit.log, {
      userId: authUser._id as string,
      event: "auth.code.generated",
    });

    return code;
  },
});

// HTTP action: called by Electron to exchange a one-time code for the stored token.
// This endpoint is public but the code is single-use and expires in 60 seconds.
export const redeemCode = httpAction(async (ctx, request) => {
  let code: string;
  try {
    const body = (await request.json()) as { code?: string };
    code = body.code ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!code) {
    return new Response(JSON.stringify({ error: "code is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(internal.loginCodes.redeemCodeInternal, { code });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ token: result.token }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// Internal mutation that does the actual redemption inside a Convex transaction.
export const redeemCodeInternal = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    const record = await ctx.db
      .query("loginCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (!record) {
      return { ok: false, error: "Invalid or expired code" };
    }

    if (record.used) {
      return { ok: false, error: "Code has already been used" };
    }

    if (Date.now() > record.expiresAt) {
      await ctx.db.delete(record._id);
      await ctx.runMutation(internal.audit.log, {
        event: "auth.code.expired",
        metadata: { codeId: record._id },
      });
      return { ok: false, error: "Code has expired" };
    }

    await ctx.db.patch(record._id, { used: true });

    await ctx.runMutation(internal.audit.log, {
      event: "auth.code.redeemed",
    });

    return { ok: true, token: record.token };
  },
});

// Internal mutation to purge expired/used codes — called by daily cron.
export const cleanupExpiredCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("loginCodes")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(500);
    for (const record of stale) {
      await ctx.db.delete(record._id);
    }
  },
});
