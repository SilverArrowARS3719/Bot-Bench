import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';

// Who is signed in (null when nobody is).
export const me = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    const user = userId && await ctx.db.get(userId);
    return user ? { email: user.email ?? '', name: user.name ?? (user.email ?? '').split('@')[0] } : null;
  },
});

// The signed-in person's saved work.
export const get = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return (await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', userId)).unique())?.data ?? {};
  },
});

const LIMIT = 900_000; // a Convex document holds up to 1 MB
export const put = mutation({
  args: { data: v.record(v.string(), v.string()) },
  handler: async (ctx, { data }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not signed in');
    if (JSON.stringify(data).length > LIMIT) throw new Error('Too big to save');
    const row = await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', userId)).unique();
    if (row) await ctx.db.patch(row._id, { data, updated: Date.now() });
    else await ctx.db.insert('saves', { userId, data, updated: Date.now() });
  },
});
