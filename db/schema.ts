import { pgTable, serial, text, integer, bigint, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  driveFolderId: text("drive_folder_id").default(""),
  driveFileId: text("drive_file_id").notNull(),
  fields: jsonb("fields").notNull().$type<Array<{ key: string; label: string; required: boolean }>>(),
  createdBy: bigint("created_by", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const filledDocuments = pgTable("filled_documents", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  filledData: jsonb("filled_data").notNull().$type<Record<string, string>>(),
  driveFileId: text("drive_file_id").default(""),
  driveLink: text("drive_link").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const fillSessions = pgTable("fill_sessions", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  state: text("state").notNull().default("idle"),
  templateId: integer("template_id"),
  collectedData: jsonb("collected_data").$type<Record<string, string>>().default({}),
  currentFieldIndex: integer("current_field_index").default(0),
  adminState: text("admin_state").default(""),
  tempTemplateName: text("temp_template_name").default(""),
  tempTemplateFields: jsonb("temp_template_fields").$type<Array<{ key: string; label: string; required: boolean }>>().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
