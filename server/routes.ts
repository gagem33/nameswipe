import type { Express, Request, Response } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import { insertSwipeSchema } from "@shared/schema";

// SSE clients: roomId -> Set of Response objects
const sseClients = new Map<string, Set<Response>>();

function broadcast(roomId: string, event: string, data: unknown) {
  const clients = sseClients.get(roomId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of Array.from(clients)) {
    try { res.write(payload); } catch {}
  }
}

export async function registerRoutes(httpServer: ReturnType<typeof createServer>, app: Express) {

  // ── Rooms ──────────────────────────────────────────────────
  // Create a new room
  app.post("/api/rooms", async (req, res) => {
    // Generate a 6-char alphanumeric code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = await storage.createRoom(code);
    res.json(room);
  });

  // Check if room exists
  app.get("/api/rooms/:id", async (req, res) => {
    const room = await storage.getRoom(req.params.id.toUpperCase());
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json(room);
  });

  // ── Swipes ─────────────────────────────────────────────────
  // Submit a swipe
  app.post("/api/swipes", async (req, res) => {
    const parsed = insertSwipeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const data = parsed.data;
    data.roomId = data.roomId.toUpperCase();

    // Ensure room exists
    const room = await storage.getRoom(data.roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

    const swipe = await storage.addSwipe(data);

    // Broadcast swipe to all room members
    broadcast(data.roomId, "swipe", {
      userId: swipe.userId,
      name: swipe.name,
      gender: swipe.gender,
      action: swipe.action,
    });

    // Check for new mutual match
    if (data.action !== "nope") {
      const matches = await storage.getMutualMatches(data.roomId);
      const newMatch = matches.find(m => m.name === data.name && m.gender === data.gender);
      if (newMatch) {
        broadcast(data.roomId, "match", newMatch);
      }
    }

    res.json(swipe);
  });

  // Get all swipes for a room (for a specific user)
  app.get("/api/rooms/:id/swipes", async (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const swipes = await storage.getSwipesByUser(roomId, userId);
    res.json(swipes);
  });

  // Get mutual matches
  app.get("/api/rooms/:id/matches", async (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const room = await storage.getRoom(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });
    const matches = await storage.getMutualMatches(roomId);
    res.json(matches);
  });

  // Get room members count
  app.get("/api/rooms/:id/members", async (req, res) => {
    const roomId = req.params.id.toUpperCase();
    const userIds = await storage.getRoomUserIds(roomId);
    res.json({ count: userIds.length, userIds });
  });

  // ── SSE — Real-time updates ────────────────────────────────
  app.get("/api/rooms/:id/stream", (req, res) => {
    const roomId = req.params.id.toUpperCase();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial ping
    res.write(`event: connected\ndata: {"roomId":"${roomId}"}\n\n`);

    // Register client
    if (!sseClients.has(roomId)) sseClients.set(roomId, new Set());
    sseClients.get(roomId)!.add(res);

    // Keepalive ping every 25s
    const keepalive = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { clearInterval(keepalive); }
    }, 25000);

    // Cleanup on disconnect
    req.on("close", () => {
      clearInterval(keepalive);
      sseClients.get(roomId)?.delete(res);
    });
  });
}
