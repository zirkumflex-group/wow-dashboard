import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

const metadataValidator = v.optional(
  v.union(
    v.object({ name: v.string() }),                                                          // auth.user.created
    v.object({ providerId: v.string() }),                                                    // auth.account.created / updated
    v.object({ codeId: v.string() }),                                                        // auth.code.expired
    v.object({ retryAfter: v.number() }),                                                    // battlenet.resync.rate_limited
    v.object({
      newChars: v.number(),
      newSnapshots: v.number(),
      newMythicPlusRuns: v.number(),
      totalCharacters: v.number(),
    }) // addon.ingest
  )
);

export const log = internalMutation({
  args: {
    userId: v.optional(v.string()),
    event: v.string(),
    metadata: metadataValidator,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", {
      userId: args.userId,
      event: args.event,
      metadata: args.metadata,
      error: args.error,
      timestamp: Date.now(),
    });
  },
});
