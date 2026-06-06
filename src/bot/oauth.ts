import { google } from "googleapis";
import { db, settings } from "../lib/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
];

export function getCallbackUrl(): string {
  if (process.env.RENDER_EXTERNAL_URL) {
    return `${process.env.RENDER_EXTERNAL_URL}/api/auth/google/callback`;
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  return `https://${domain}/api/auth/google/callback`;
}

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, getCallbackUrl());
}

export function getAuthUrl(): string | null {
  const client = getOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(code: string): Promise<boolean> {
  try {
    const client = getOAuth2Client();
    if (!client) return false;
    const { tokens } = await client.getToken(code);
    if (tokens.refresh_token) {
      await db
        .insert(settings)
        .values({ key: "google_refresh_token", value: tokens.refresh_token })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: tokens.refresh_token, updatedAt: new Date() },
        });
      logger.info("Stored Google OAuth refresh token");
    }
    if (tokens.access_token) {
      await db
        .insert(settings)
        .values({ key: "google_access_token", value: tokens.access_token })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: tokens.access_token, updatedAt: new Date() },
        });
    }
    return true;
  } catch (err) {
    logger.error(err, "Failed to exchange OAuth code");
    return false;
  }
}

export async function getAuthorizedClient() {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "google_refresh_token"));
  const refreshToken = rows[0]?.value;
  if (!refreshToken) return null;
  const client = getOAuth2Client();
  if (!client) return null;
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function isGoogleAuthorized(): Promise<boolean> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "google_refresh_token"));
  return rows.length > 0 && !!rows[0]?.value;
}
