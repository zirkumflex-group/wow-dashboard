import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { isRunMutationCtx } from "@convex-dev/better-auth/utils";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!user.email?.endsWith("@battlenet.local")) return;
            if (!isRunMutationCtx(ctx)) return;
            await ctx.runMutation(internal.players.upsertFromBattleNet, {
              userId: user.id,
              battleTag: user.name ?? "",
            });
          },
        },
      },
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
      genericOAuth({
        config: [
          {
            providerId: "battlenet",
            clientId: process.env.BATTLENET_CLIENT_ID!,
            clientSecret: process.env.BATTLENET_CLIENT_SECRET!,
            authorizationUrl: "https://oauth.battle.net/authorize",
            tokenUrl: "https://oauth.battle.net/token",
            userInfoUrl: "https://oauth.battle.net/userinfo",
            scopes: ["openid"],
            mapProfileToUser: (profile: Record<string, string>) => ({
              id: String(profile.sub),
              name: profile.battletag ?? profile.battle_tag ?? String(profile.sub),
              // Battle.net does not expose email — construct a stable placeholder.
              email: `${profile.sub}.${(profile.battletag ?? profile.battle_tag ?? "").replace("#", "-")}@battlenet.local`,
              emailVerified: true,
            }),
          },
        ],
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});
