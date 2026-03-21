import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

export const log = internalMutation({
  args: {
    userId: v.optional(v.string()),
    event: v.string(),
    metadata: v.optional(v.any()),
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
