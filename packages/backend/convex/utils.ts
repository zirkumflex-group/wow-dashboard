import { internalMutation } from "./_generated/server";
import { DataModel } from "./_generated/dataModel";
import schema from "./schema";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Derive table names from the schema so new tables are picked up automatically
    const tables = Object.keys(schema.tables) as (keyof DataModel)[];

    for (const table of tables) {
      const docs = await ctx.db.query(table).collect();
      await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
    }

    // Seed data goes here once tables are defined
  },
});
