import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MutualMatch } from "@shared/schema";
import {
  Heart, X, Star, RotateCcw, Filter, Moon, Sun, Copy, Check,
  Users, Sparkles, ChevronLeft, Search, Trophy
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Helpers ────────────────────────────────────────────────────
function genUserId() {
  return Math.random().toString(36).substring(2, 18);
}

function getUserId() {
  // Use a module-level variable so it's stable for the session
  return window.__nameswipeUserId || (window.__nameswipeUserId = genUserId());
}

declare global {
  interface Window { __nameswipeUserId: string; __nameswipeTheme?: string; }
}

// ── Types ──────────────────────────────────────────────────────
interface NameEntry { name: string; gender: "boy" | "girl"; }
interface LikedName extends NameEntry { starred: boolean; }

// ── Name data cache ────────────────────────────────────────────
let namesCache: NameEntry[] | null = null;
async function loadNames(): Promise<NameEntry[]> {
  if (namesCache) return namesCache;
  const res = await fetch("/names.json");
  const data = await res.json();
  const boys: NameEntry[]  = data.boys.map((n: string) => ({ name: n, gender: "boy"  as const }));
  const girls: NameEntry[] = data.girls.map((n: string) => ({ name: n, gender: "girl" as const }));
  // Shuffle interleaved
  const all = [...boys, ...girls];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  namesCache = all;
  return all;
}

// ── Room page ──────────────────────────────────────────────────
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const roomId = code?.toUpperCase() ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Theme
  const [dark, setDark] = useState(() => {
    const stored = window.__nameswipeTheme;
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.__nameswipeTheme = dark ? "dark" : "light";
  }, [dark]);

  // Names
  const [deck, setDeck] = useState<NameEntry[]>([]);
  const [deckPos, setDeckPos] = useState(0);
  const [likedNames, setLikedNames] = useState<LikedName[]>([]);
  const [swipeHistory, setSwipeHistory] = useState<{ entry: NameEntry; action: string }[]>([]);
  const [animating, setAnimating] = useState(false);
  const [hintShown, setHintShown] = useState(false);

  // Filters
  const [showBoys, setShowBoys] = useState(true);
  const [showGirls, setShowGirls] = useState(true);
  const [showBadge, setShowBadge] = useState(true);

  // Tabs
  const [tab, setTab] = useState<"swipe" | "liked" | "matches">("swipe");

  // Liked filters
  const [likedFilter, setLikedFilter] = useState<"all" | "boy" | "girl" | "starred">("all");
  const [searchQ, setSearchQ] = useState("");

  // Match notification
  const [newMatch, setNewMatch] = useState<MutualMatch | null>(null);
  const [matches, setMatches] = useState<MutualMatch[]>([]);

  // Shared code copy
  const [copied, setCopied] = useState(false);

  // Filter sheet
  const [filterOpen, setFilterOpen] = useState(false);

  // Partner activity
  const [partnerActive, setPartnerActive] = useState(false);

  // Drag state
  const dragRef = useRef({ active: false, startX: 0, startY: 0, curX: 0, curY: 0 });
  const topCardRef = useRef<HTMLDivElement>(null);

  // Load names
  useEffect(() => {
    loadNames().then(all => {
      const filtered = all.filter(n =>
        (n.gender === "boy" ? showBoys : showGirls)
      );
      setDeck(filtered);
      setDeckPos(0);
    });
  }, []);

  // Rebuild deck when filters change
  useEffect(() => {
    if (!namesCache) return;
    const filtered = namesCache.filter(n =>
      (n.gender === "boy" ? showBoys : showGirls)
    );
    setDeck(filtered);
    setDeckPos(0);
  }, [showBoys, showGirls]);

  // Verify room exists
  const { isError } = useQuery({
    queryKey: ["/api/rooms", roomId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rooms/${roomId}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    retry: false,
  });

  // Load initial matches
  useQuery({
    queryKey: ["/api/rooms", roomId, "matches"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rooms/${roomId}/matches`);
      const data = await res.json();
      setMatches(data);
      return data;
    },
    refetchInterval: 30000,
  });

  // SSE connection
  useEffect(() => {
    if (!roomId) return;
    const es = new EventSource(`/api/rooms/${roomId}/stream`);

    es.addEventListener("connected", () => setPartnerActive(false));

    es.addEventListener("swipe", (e) => {
      const data = JSON.parse(e.data);
      if (data.userId !== getUserId()) {
        // Partner swiped — show subtle indicator
        setPartnerActive(true);
        setTimeout(() => setPartnerActive(false), 2000);
      }
    });

    es.addEventListener("match", (e) => {
      const match: MutualMatch = JSON.parse(e.data);
      setMatches(prev => {
        const exists = prev.some(m => m.name === match.name && m.gender === match.gender);
        if (exists) return prev;
        return [match, ...prev];
      });
      setNewMatch(match);
      setTimeout(() => setNewMatch(null), 4000);
      qc.invalidateQueries({ queryKey: ["/api/rooms", roomId, "matches"] });
    });

    return () => es.close();
  }, [roomId]);

  // Swipe mutation
  const swipeMutation = useMutation({
    mutationFn: async ({ name, gender, action }: { name: string; gender: string; action: string }) => {
      const res = await apiRequest("POST", "/api/swipes", {
        roomId,
        userId: getUserId(),
        name,
        gender,
        action,
      });
      return res.json();
    },
  });

  // Current card
  const currentEntry = deck[deckPos] ?? null;
  const peek1 = deck[deckPos + 1] ?? null;
  const peek2 = deck[deckPos + 2] ?? null;

  // Trigger a swipe action
  const triggerSwipe = useCallback((action: "like" | "nope" | "super") => {
    if (animating || !currentEntry) return;
    if (!hintShown) setHintShown(true);

    const entry = currentEntry;
    setAnimating(true);
    setSwipeHistory(h => [...h.slice(-19), { entry, action }]);

    if (action === "like" || action === "super") {
      setLikedNames(prev => {
        const exists = prev.find(n => n.name === entry.name && n.gender === entry.gender);
        if (exists) {
          if (action === "super" && !exists.starred) {
            return prev.map(n => n.name === entry.name ? { ...n, starred: true } : n);
          }
          return prev;
        }
        return [{ ...entry, starred: action === "super" }, ...prev];
      });
    }

    // Animate card
    const card = topCardRef.current;
    if (card) {
      card.classList.add(action === "like" ? "swipe-out-right" : action === "nope" ? "swipe-out-left" : "swipe-out-up");
    }

    // Submit to API
    swipeMutation.mutate({ name: entry.name, gender: entry.gender, action });

    setTimeout(() => {
      setDeckPos(p => p + 1);
      setAnimating(false);
    }, 360);
  }, [animating, currentEntry, hintShown, swipeMutation]);

  // Undo
  const undo = useCallback(() => {
    if (swipeHistory.length === 0 || animating) return;
    const last = swipeHistory[swipeHistory.length - 1];
    setSwipeHistory(h => h.slice(0, -1));
    if (last.action !== "nope") {
      setLikedNames(prev => prev.filter(n => !(n.name === last.entry.name && n.gender === last.entry.gender)));
    }
    setDeckPos(p => Math.max(0, p - 1));
  }, [swipeHistory, animating]);

  // Drag handlers
  function onDragStart(e: React.TouchEvent | React.MouseEvent) {
    if (animating || !currentEntry) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { active: true, startX: clientX, startY: clientY, curX: clientX, curY: clientY };
    if (topCardRef.current) topCardRef.current.style.transition = "none";
  }

  function onDragMove(e: React.TouchEvent | React.MouseEvent) {
    if (!dragRef.current.active) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current.curX = clientX;
    dragRef.current.curY = clientY;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    if (topCardRef.current) {
      topCardRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.06}deg)`;
      const likeStamp = topCardRef.current.querySelector<HTMLElement>(".stamp-like");
      const nopeStamp = topCardRef.current.querySelector<HTMLElement>(".stamp-nope");
      if (likeStamp && nopeStamp) {
        likeStamp.style.opacity = dx > 40 ? String(Math.min((dx - 40) / 80, 1)) : "0";
        nopeStamp.style.opacity = dx < -40 ? String(Math.min((-dx - 40) / 80, 1)) : "0";
      }
    }
  }

  function onDragEnd() {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const dx = dragRef.current.curX - dragRef.current.startX;
    const dy = dragRef.current.curY - dragRef.current.startY;
    if (dx > 80) triggerSwipe("like");
    else if (dx < -80) triggerSwipe("nope");
    else if (dy < -80 && Math.abs(dx) < 60) triggerSwipe("super");
    else {
      if (topCardRef.current) {
        topCardRef.current.classList.add("snap-back");
        topCardRef.current.style.transform = "";
        const likeStamp = topCardRef.current.querySelector<HTMLElement>(".stamp-like");
        const nopeStamp = topCardRef.current.querySelector<HTMLElement>(".stamp-nope");
        if (likeStamp) likeStamp.style.opacity = "0";
        if (nopeStamp) nopeStamp.style.opacity = "0";
        setTimeout(() => topCardRef.current?.classList.remove("snap-back"), 350);
      }
    }
  }

  // Copy room code
  function copyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Liked grid filtered
  const filteredLiked = likedNames
    .filter(n => {
      if (likedFilter === "boy") return n.gender === "boy";
      if (likedFilter === "girl") return n.gender === "girl";
      if (likedFilter === "starred") return n.starred;
      return true;
    })
    .filter(n => !searchQ || n.name.toLowerCase().includes(searchQ.toLowerCase()));

  // Room not found
  if (isError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="text-6xl">😕</div>
        <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Room not found</h2>
        <p className="text-muted-foreground">The room code <strong>{roomId}</strong> doesn't exist.</p>
        <Button onClick={() => navigate("/")}>← Back Home</Button>
      </div>
    );
  }

  const progress = deck.length > 0 ? (deckPos / deck.length) * 100 : 0;
  const remaining = Math.max(0, deck.length - deckPos);
  const genderLabel = showBoys && showGirls ? "Boys & Girls" : showBoys ? "Boy names" : "Girl names";

  return (
    <div className="flex flex-col h-dvh max-w-[480px] mx-auto overflow-hidden bg-background relative">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 pt-safe border-b border-border flex-shrink-0 bg-background/95 backdrop-blur-sm">
        <button onClick={() => navigate("/")} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors p-1">
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button onClick={copyCode} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent border border-border text-accent-foreground hover:bg-accent/80 transition-all">
          <span className="text-sm font-bold tracking-widest">{roomId}</span>
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-2">
          {partnerActive && (
            <span className="text-xs bg-green-500/15 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full font-semibold animate-pulse">
              ● Partner
            </span>
          )}
          <button
            onClick={() => setDark(d => !d)}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-secondary hover:bg-muted transition-colors text-muted-foreground"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setFilterOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-secondary hover:bg-muted transition-colors text-muted-foreground"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <nav className="flex border-b border-border flex-shrink-0 bg-background">
        {(["swipe", "liked", "matches"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 relative ${
              tab === t ? "text-primary border-primary" : "text-muted-foreground border-transparent"
            }`}
          >
            {t === "swipe" && "Discover"}
            {t === "liked" && `Saved (${likedNames.length})`}
            {t === "matches" && (
              <span className="flex items-center justify-center gap-1">
                <Trophy className="w-3.5 h-3.5" />
                Matches {matches.length > 0 && (
                  <span className="ml-1 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">
                    {matches.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Match notification ───────────────────────────────── */}
      {newMatch && (
        <div className="absolute top-[120px] left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-gradient-to-r from-rose-500 to-amber-400 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 match-pop">
            <Heart className="w-5 h-5 fill-white heart-beat" />
            <span className="font-bold text-base">It's a match! <span className="underline">{newMatch.name}</span> 🎉</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* SWIPE TAB                                             */}
      {/* ══════════════════════════════════════════════════════ */}
      {tab === "swipe" && (
        <div className="flex flex-col flex-1 overflow-hidden px-5 py-3 gap-3">

          {/* Progress */}
          <div className="space-y-1.5 flex-shrink-0">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="font-medium">{genderLabel}</span>
              <span>{deckPos.toLocaleString()} / {deck.length.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--gold)))" }}
              />
            </div>
          </div>

          {/* Card stack */}
          <div className="flex-1 relative flex items-center justify-center min-h-0">
            {!currentEntry ? (
              <div className="text-center space-y-4 py-8">
                <div className="text-6xl">✨</div>
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
                  All done!
                </h3>
                <p className="text-muted-foreground text-sm max-w-[260px] mx-auto">
                  You've swiped through all {deck.length.toLocaleString()} names.
                  {likedNames.length > 0 && ` You saved ${likedNames.length} names.`}
                </p>
                <Button
                  onClick={() => { setDeckPos(0); setSwipeHistory([]); }}
                  className="rounded-full gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Start Over
                </Button>
              </div>
            ) : (
              <>
                {/* Back cards (stack effect) */}
                {peek2 && (
                  <div className="absolute inset-x-0 card-shadow rounded-3xl bg-card border border-border"
                    style={{ transform: "scale(0.88) translateY(20px)", zIndex: 1, opacity: 0.5 }} />
                )}
                {peek1 && (
                  <div className="absolute inset-x-0 card-shadow rounded-3xl bg-card border border-border"
                    style={{ transform: "scale(0.94) translateY(10px)", zIndex: 2, opacity: 0.75 }} />
                )}

                {/* Top card */}
                <div
                  ref={topCardRef}
                  className="absolute inset-x-0 card-shadow rounded-3xl bg-card border border-border flex flex-col items-center justify-center gap-4 p-8 cursor-grab active:cursor-grabbing select-none"
                  style={{ zIndex: 5, touchAction: "none" }}
                  onMouseDown={onDragStart}
                  onMouseMove={onDragMove}
                  onMouseUp={onDragEnd}
                  onMouseLeave={onDragEnd}
                  onTouchStart={onDragStart}
                  onTouchMove={onDragMove}
                  onTouchEnd={onDragEnd}
                >
                  {/* Stamp overlays */}
                  <div className="stamp-like absolute top-8 left-6 border-[3px] border-green-500 text-green-500 rounded-lg px-3 py-1 font-bold text-lg rotate-[-12deg] opacity-0 pointer-events-none" style={{ fontFamily: "var(--font-display)" }}>
                    SAVE ❤️
                  </div>
                  <div className="stamp-nope absolute top-8 right-6 border-[3px] border-rose-500 text-rose-500 rounded-lg px-3 py-1 font-bold text-lg rotate-[12deg] opacity-0 pointer-events-none" style={{ fontFamily: "var(--font-display)" }}>
                    SKIP ✗
                  </div>

                  {/* Name */}
                  <div
                    className="text-center font-bold leading-tight"
                    style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem, 9vw, 4rem)" }}
                  >
                    {currentEntry.name}
                  </div>

                  {/* Gender badge */}
                  {showBadge && (
                    <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold border ${
                      currentEntry.gender === "boy"
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                        : "bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                    }`}>
                      {currentEntry.gender === "boy" ? "👦 Boy" : "👧 Girl"}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Swipe hint */}
          {!hintShown && currentEntry && (
            <div className="flex justify-center gap-6 text-xs text-muted-foreground/60 flex-shrink-0">
              <span className="flex items-center gap-1">← Skip</span>
              <span className="flex items-center gap-1">❤️ Save →</span>
              <span className="flex items-center gap-1">↑ Star</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-5 flex-shrink-0 pb-safe py-2">
            <button
              data-testid="button-undo"
              onClick={undo}
              disabled={swipeHistory.length === 0 || animating}
              className="w-[52px] h-[52px] rounded-full flex items-center justify-center border-2 border-border bg-card text-muted-foreground disabled:opacity-30 transition-all active:scale-90"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              data-testid="button-nope"
              onClick={() => triggerSwipe("nope")}
              disabled={!currentEntry || animating}
              className="w-[64px] h-[64px] rounded-full flex items-center justify-center border-2 border-border bg-card text-rose-500 hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-30 transition-all active:scale-90"
            >
              <X className="w-7 h-7" strokeWidth={2.5} />
            </button>
            <button
              data-testid="button-like"
              onClick={() => triggerSwipe("like")}
              disabled={!currentEntry || animating}
              className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-lg shadow-rose-200 dark:shadow-rose-900/40 disabled:opacity-30 transition-all active:scale-90 hover:bg-primary/90"
            >
              <Heart className="w-8 h-8 fill-current" />
            </button>
            <button
              data-testid="button-super"
              onClick={() => triggerSwipe("super")}
              disabled={!currentEntry || animating}
              className="w-[52px] h-[52px] rounded-full flex items-center justify-center border-2 border-border bg-card text-amber-500 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-30 transition-all active:scale-90"
            >
              <Star className="w-5 h-5 fill-amber-500" />
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* LIKED TAB                                             */}
      {/* ══════════════════════════════════════════════════════ */}
      {tab === "liked" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-5 pt-4 pb-3 space-y-3 flex-shrink-0">
            <div>
              <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Your Saved Names</h2>
              <p className="text-sm text-muted-foreground">{likedNames.length} names saved</p>
            </div>
            {/* Filter chips */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {(["all", "boy", "girl", "starred"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setLikedFilter(f)}
                  className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                    likedFilter === f
                      ? f === "boy" ? "bg-blue-500 border-blue-500 text-white"
                        : f === "girl" ? "bg-primary border-primary text-white"
                        : "bg-primary border-primary text-white"
                      : "border-border text-muted-foreground bg-card"
                  }`}
                >
                  {f === "all" && "All"}
                  {f === "boy" && "👦 Boys"}
                  {f === "girl" && "👧 Girls"}
                  {f === "starred" && "⭐ Starred"}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Search saved names…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary transition-colors"
              />
            </div>
            <div className="text-xs text-muted-foreground">{filteredLiked.length} names</div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-safe">
            {filteredLiked.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <div className="text-5xl">🌸</div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>No names yet</p>
                <p className="text-muted-foreground text-sm">Start swiping to save names you love</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-3">
                {filteredLiked.map((n, i) => (
                  <div
                    key={`${n.name}-${n.gender}`}
                    className="pop-in bg-card border border-border rounded-2xl p-4 relative cursor-pointer hover:border-primary/50 transition-all"
                    style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
                    onClick={() => {
                      setLikedNames(prev => prev.map(p =>
                        p.name === n.name && p.gender === n.gender ? { ...p, starred: !p.starred } : p
                      ));
                    }}
                  >
                    {n.starred && <span className="absolute top-2 left-2 text-xs">⭐</span>}
                    <button
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-rose-100 hover:text-rose-500 dark:hover:bg-rose-900/30 transition-colors text-xs"
                      onClick={e => {
                        e.stopPropagation();
                        setLikedNames(prev => prev.filter(p => !(p.name === n.name && p.gender === n.gender)));
                      }}
                    >✕</button>
                    <div className="font-bold text-xl leading-tight mt-1" style={{ fontFamily: "var(--font-display)" }}>{n.name}</div>
                    <span className={`mt-2 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      n.gender === "boy" ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400"
                    }`}>
                      {n.gender === "boy" ? "👦 Boy" : "👧 Girl"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MATCHES TAB                                           */}
      {/* ══════════════════════════════════════════════════════ */}
      {tab === "matches" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex-shrink-0 space-y-1">
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Mutual Matches</h2>
            <p className="text-sm text-muted-foreground">Names you <em>both</em> saved — your real shortlist</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-safe">
            {matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <div className="text-5xl">💑</div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>No matches yet</p>
                <p className="text-muted-foreground text-sm max-w-[240px]">
                  Share your room code <strong>{roomId}</strong> with your partner and start swiping together!
                </p>
                <button
                  onClick={copyCode}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent border border-border text-sm font-bold"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  Copy Room Code
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-3">
                {matches.map((m, i) => (
                  <div
                    key={`${m.name}-${m.gender}`}
                    className="pop-in relative bg-gradient-to-br from-rose-50 to-amber-50 dark:from-rose-900/20 dark:to-amber-900/20 border border-rose-200 dark:border-rose-700/50 rounded-2xl p-4"
                    style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
                  >
                    <div className="absolute top-2 right-2">
                      <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
                    </div>
                    {(m.user1Super || m.user2Super) && (
                      <div className="absolute top-2 left-2 text-xs">⭐</div>
                    )}
                    <div className="font-bold text-xl leading-tight mt-1 match-shimmer" style={{ fontFamily: "var(--font-display)" }}>
                      {m.name}
                    </div>
                    <span className={`mt-2 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      m.gender === "boy" ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : "bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
                    }`}>
                      {m.gender === "boy" ? "👦 Boy" : "👧 Girl"}
                    </span>
                    {(m.user1Super && m.user2Super) && (
                      <div className="mt-2 text-xs font-bold text-amber-500 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Both starred!
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Filter Sheet ─────────────────────────────────────── */}
      {filterOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setFilterOpen(false)} />
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-background rounded-t-3xl p-6 pb-safe z-50 shadow-2xl flex flex-col gap-5">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-1" />
            <h3 className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>Filters & Settings</h3>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 bg-muted rounded-2xl p-4">
              {[
                { val: deckPos.toLocaleString(), lbl: "Swiped" },
                { val: likedNames.length.toLocaleString(), lbl: "Saved" },
                { val: remaining.toLocaleString(), lbl: "Left" },
              ].map(s => (
                <div key={s.lbl} className="text-center">
                  <div className="text-2xl font-bold text-primary" style={{ fontFamily: "var(--font-display)" }}>{s.val}</div>
                  <div className="text-xs text-muted-foreground">{s.lbl}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Show Names</p>
              {[
                { label: "👦 Boy names", val: showBoys, set: setShowBoys },
                { label: "👧 Girl names", val: showGirls, set: setShowGirls },
              ].map(({ label, val, set }) => (
                <div key={label} className="flex justify-between items-center py-3 border-b border-border">
                  <span className="font-medium">{label}</span>
                  <button
                    onClick={() => set(v => !v)}
                    className={`w-12 h-7 rounded-full relative transition-colors ${val ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${val ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              ))}
              <div className="flex justify-between items-center py-3 border-b border-border">
                <span className="font-medium">Show gender badge</span>
                <button
                  onClick={() => setShowBadge(v => !v)}
                  className={`w-12 h-7 rounded-full relative transition-colors ${showBadge ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${showBadge ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full rounded-2xl h-12"
              onClick={() => { setDeckPos(0); setSwipeHistory([]); setFilterOpen(false); }}
            >
              <RotateCcw className="w-4 h-4 mr-2" /> Reset & Start Over
            </Button>

            <Button className="w-full rounded-2xl h-12" onClick={() => setFilterOpen(false)}>
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
