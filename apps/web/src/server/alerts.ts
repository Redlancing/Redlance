import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  alertChannels,
  telegramLinkTokens,
  createTelegramLinkToken,
  disableChannel,
  profiles,
  type Database,
} from "@redlance/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { ApiError } from "./errors";

export type AlertSettings = {
  minScore: number;
  dailyCap: number;
  telegram: {
    linked: boolean;
    enabled: boolean;
    disabledReason: string | null;
  };
};

export type AlertSettingsPatch = { minScore?: number; dailyCap?: number };

const notOnboarded = () =>
  new ApiError("FORBIDDEN", "Finish onboarding first.");

/** The user's alert settings. Never includes the chat id. */
export async function getAlertSettings(
  db: Database,
  userId: string,
): Promise<AlertSettings> {
  const [p] = await db
    .select({
      minScore: profiles.alertMinScore,
      dailyCap: profiles.alertsDailyCap,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!p) throw notOnboarded();
  const [ch] = await db
    .select({
      enabled: alertChannels.enabled,
      verifiedAt: alertChannels.verifiedAt,
      disabledReason: alertChannels.disabledReason,
    })
    .from(alertChannels)
    .where(
      and(eq(alertChannels.userId, userId), eq(alertChannels.kind, "telegram")),
    );
  return {
    minScore: p.minScore,
    dailyCap: p.dailyCap,
    telegram: {
      linked: !!ch?.verifiedAt,
      enabled: !!ch?.enabled,
      disabledReason: ch?.enabled ? null : (ch?.disabledReason ?? null),
    },
  };
}

export async function updateAlertSettings(
  db: Database,
  userId: string,
  patch: AlertSettingsPatch,
): Promise<AlertSettings> {
  const set = {
    ...(patch.minScore === undefined ? {} : { alertMinScore: patch.minScore }),
    ...(patch.dailyCap === undefined ? {} : { alertsDailyCap: patch.dailyCap }),
  };
  if (Object.keys(set).length > 0) {
    const res = await db
      .update(profiles)
      .set(set)
      .where(eq(profiles.userId, userId))
      .returning({ userId: profiles.userId });
    if (res.length === 0) throw notOnboarded();
  }
  return getAlertSettings(db, userId);
}

/** Marks the user's unused, unexpired link tokens as used, so old links stop working. */
async function revokeLinkTokens(db: Database, userId: string): Promise<void> {
  await db
    .update(telegramLinkTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(telegramLinkTokens.userId, userId),
        isNull(telegramLinkTokens.usedAt),
        gt(telegramLinkTokens.expiresAt, sql`now()`),
      ),
    );
}

/** A one-time link: only the token's SHA-256 is stored. */
export async function startTelegramLink(
  db: Database,
  userId: string,
  botUsername: string,
): Promise<{ url: string; expiresAt: string }> {
  await revokeLinkTokens(db, userId);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const expiresAt = await createTelegramLinkToken(db, userId, hash);
  return {
    url: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Turns the Telegram channel off. Safe to call again, or with no channel. */
export async function unlinkTelegram(
  db: Database,
  userId: string,
): Promise<void> {
  await revokeLinkTokens(db, userId);
  await disableChannel(db, userId, "telegram", "user_stop");
}
