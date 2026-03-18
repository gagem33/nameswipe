import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { z } from "zod";

// Rooms — a couple's shared session
export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Swipes — each person's vote on a name
export const swipes = pgTable("swipes", {
  id: integer("id").primaryKey(),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  gender: text("gender").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Manual schemas (avoids drizzle-zod inference issues with generatedAlwaysAsIdentity)
export const insertRoomSchema = z.object({
  id: z.string(),
});

export const insertSwipeSchema = z.object({
  roomId: z.string(),
  userId: z.string(),
  name: z.string(),
  gender: z.string(),
  action: z.string(),
});

export type Room = { id: string; createdAt: Date };
export type Swipe = { id: number; roomId: string; userId: string; name: string; gender: string; action: string; createdAt: Date };
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type InsertSwipe = z.infer<typeof insertSwipeSchema>;

// Mutual match = name liked by BOTH users in the room
export interface MutualMatch {
  name: string;
  gender: string;
  user1Super: boolean;
  user2Super: boolean;
  matchedAt: Date;
}
