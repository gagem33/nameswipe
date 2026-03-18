import type { Room, Swipe, InsertSwipe, MutualMatch } from "@shared/schema";

export interface IStorage {
  // Rooms
  createRoom(id: string): Promise<Room>;
  getRoom(id: string): Promise<Room | null>;

  // Swipes
  addSwipe(swipe: InsertSwipe): Promise<Swipe>;
  getSwipesByRoom(roomId: string): Promise<Swipe[]>;
  getSwipesByUser(roomId: string, userId: string): Promise<Swipe[]>;
  getMutualMatches(roomId: string): Promise<MutualMatch[]>;
  getRoomUserIds(roomId: string): Promise<string[]>;
}

export class MemStorage implements IStorage {
  private rooms: Map<string, Room> = new Map();
  private swipes: Swipe[] = [];
  private nextId = 1;

  async createRoom(id: string): Promise<Room> {
    const room: Room = { id, createdAt: new Date() };
    this.rooms.set(id, room);
    return room;
  }

  async getRoom(id: string): Promise<Room | null> {
    return this.rooms.get(id) ?? null;
  }

  async addSwipe(swipe: InsertSwipe): Promise<Swipe> {
    // Remove previous swipe for same name/user if exists
    this.swipes = this.swipes.filter(
      s => !(s.roomId === swipe.roomId && s.userId === swipe.userId && s.name === swipe.name)
    );
    const s: Swipe = { ...swipe, id: this.nextId++, createdAt: new Date() };
    this.swipes.push(s);
    return s;
  }

  async getSwipesByRoom(roomId: string): Promise<Swipe[]> {
    return this.swipes.filter(s => s.roomId === roomId);
  }

  async getSwipesByUser(roomId: string, userId: string): Promise<Swipe[]> {
    return this.swipes.filter(s => s.roomId === roomId && s.userId === userId);
  }

  async getRoomUserIds(roomId: string): Promise<string[]> {
    const swipes = await this.getSwipesByRoom(roomId);
    return Array.from(new Set(swipes.map(s => s.userId)));
  }

  async getMutualMatches(roomId: string): Promise<MutualMatch[]> {
    const roomSwipes = await this.getSwipesByRoom(roomId);
    const userIds = Array.from(new Set(roomSwipes.map(s => s.userId)));

    if (userIds.length < 2) return [];

    // Group by name+gender
    const byName = new Map<string, Swipe[]>();
    for (const swipe of roomSwipes) {
      if (swipe.action === "nope") continue;
      const key = `${swipe.name}|${swipe.gender}`;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(swipe);
    }

    const matches: MutualMatch[] = [];
    for (const [key, swipeList] of Array.from(byName)) {
      // Check if at least 2 different users liked it
      const likedBy = new Set(swipeList.map(s => s.userId));
      if (likedBy.size >= 2) {
        const [name, gender] = key.split("|");
        const latest = swipeList.reduce((a, b) => a.createdAt > b.createdAt ? a : b);
        matches.push({
          name,
          gender,
          user1Super: swipeList.some(s => s.userId === userIds[0] && s.action === "super"),
          user2Super: swipeList.some(s => s.userId === userIds[1] && s.action === "super"),
          matchedAt: latest.createdAt,
        });
      }
    }

    return matches.sort((a, b) => b.matchedAt.getTime() - a.matchedAt.getTime());
  }
}

export const storage = new MemStorage();
