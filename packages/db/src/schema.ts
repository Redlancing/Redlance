import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const USER_STATUSES = ["active", "blocked"] as const;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Cognito `sub` later; "dev|<normalized email>" in dev mode.
    authSub: text("auth_sub").notNull().unique(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull().unique(),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    check("users_status_check", sql`${table.status} in ('active', 'blocked')`),
  ],
);

export type User = typeof users.$inferSelect;
