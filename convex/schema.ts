import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables, // users, sessions, accounts, verification codes (Convex Auth)
  // Each person's work, as the same key -> text pairs the studio keeps in the browser (robot, arena, code, settings).
  saves: defineTable({ userId: v.id('users'), data: v.record(v.string(), v.string()), updated: v.number() }).index('by_user', ['userId']),
});
