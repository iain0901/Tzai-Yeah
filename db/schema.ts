import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(), value: text("value").notNull(),
});
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  location: text("location").notNull().default(""), note: text("note").notNull().default(""),
  color: text("color").notNull().default("#c55b4f"),
});
export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(), name: text("name").notNull(), house: text("house").notNull().default(""),
  groupId: text("group_id").references(() => groups.id), ownerId: text("owner_id"),
  claimHash: text("claim_hash"), claimCreatedAt: text("claim_created_at"),
  profile: text("profile").notNull().default('{"displayName":"","bio":"","url":"","mode":"page"}'),
  checkedInAt: text("checked_in_at"), createdAt: text("created_at").notNull(),
});
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(), serial: text("serial").notNull(), token: text("token").notNull(),
  active: integer("active").notNull().default(1), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("cards_serial_unique").on(table.serial), uniqueIndex("cards_token_unique").on(table.token)]);
export const bindings = sqliteTable("card_bindings", {
  cardId: text("card_id").primaryKey().references(() => cards.id),
  participantId: text("participant_id").notNull().references(() => participants.id),
}, table => [uniqueIndex("bindings_participant_unique").on(table.participantId)]);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(), actor: text("actor").notNull(), action: text("action").notNull(),
  detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
});
export const claimAttempts = sqliteTable("claim_attempts", {
  key: text("key").primaryKey(), count: integer("count").notNull().default(0), expiresAt: integer("expires_at").notNull(),
});
