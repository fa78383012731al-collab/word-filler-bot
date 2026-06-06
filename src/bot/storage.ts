import { db, templates, filledDocuments, fillSessions } from "../lib/db";
import { eq, desc } from "drizzle-orm";

export async function getSession(userId: number) {
  const rows = await db.select().from(fillSessions).where(eq(fillSessions.userId, userId));
  return rows[0] ?? null;
}

export async function upsertSession(userId: number, data: Partial<typeof fillSessions.$inferInsert>) {
  await db
    .insert(fillSessions)
    .values({ userId, state: "idle", ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: fillSessions.userId,
      set: { ...data, updatedAt: new Date() },
    });
}

export async function getAllTemplates() {
  return db.select().from(templates).orderBy(desc(templates.createdAt));
}

export async function getTemplate(id: number) {
  const rows = await db.select().from(templates).where(eq(templates.id, id));
  return rows[0] ?? null;
}

export async function createTemplate(data: typeof templates.$inferInsert) {
  const rows = await db.insert(templates).values(data).returning();
  return rows[0];
}

export async function deleteTemplate(id: number) {
  await db.delete(templates).where(eq(templates.id, id));
}

export async function saveFilledDocument(data: typeof filledDocuments.$inferInsert) {
  const rows = await db.insert(filledDocuments).values(data).returning();
  return rows[0];
}

export async function getUserHistory(userId: number) {
  return db
    .select()
    .from(filledDocuments)
    .where(eq(filledDocuments.userId, userId))
    .orderBy(desc(filledDocuments.createdAt))
    .limit(10);
}
