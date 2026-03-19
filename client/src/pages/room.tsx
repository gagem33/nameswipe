import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MutualMatch } from "@shared/schema";
import {
  Heart, X, Star, RotateCcw, Filter, Moon, Sun,
  Search, Trophy
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Stable user ID — persisted in localStorage ─────────────────
function getUserId(): string {
  try {
    let id = localStorage.getItem("nameswipe_user_id");
    if (!id) {
      id = Math.random().toString(36).substring(2, 18);
      localStorage.setItem("nameswipe_user_id", id);
    }
    return id;
  } catch {
    // Fallback to window variable if localStorage unavailable
    return (window as any).__nameswipeUserId ||
      ((window as any).__nameswipeUserId = Math.random().toString(36).substring(2, 18));
  }
}

// ── Types ──────────────────────────────────────────────────────
interface NameEntry { name: string; gender: "boy" | "girl"; meaning?: string; }
interface LikedName extends NameEntry { starred: boolean; }

// ── LocalStorage helpers ───────────────────────────────────────
const LS_LIKED = "nameswipe_liked";
const LS_DECK_POS = "nameswipe_deck_pos";
const LS_DARK = "nameswipe_dark";
const LS_SHOW_BOYS = "nameswipe_show_boys";
const LS_SHOW_GIRLS = "nameswipe_show_girls";

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v) as T;
  } catch { return fallback; }
}
function writeLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Name data — lazy loaded and cached ─────────────────────────
let namesCache: NameEntry[] | null = null;

async function loadNames(): Promise<NameEntry[]> {
  if (namesCache) return namesCache;
  const res = await fetch("/names.json");
  const data = await res.json();
  const boys: NameEntry[]  = data.boys.map((n: any) => ({
    name: typeof n === "string" ? n : n.name,
    meaning: typeof n === "string" ? "" : (n.meaning || ""),
    gender: "boy" as const,
  }));
  const girls: NameEntry[] = data.girls.map((n: any) => ({
    name: typeof n === "string" ? n : n.name,
    meaning: typeof n === "string" ? "" : (n.meaning || ""),
    gender: "girl" as const,
  }));
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
  const roomId = (code ?? "COUPLE").toUpperCase();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Theme (persisted) ────────────────────────────────────────
  const [dark, setDark] = useState(() =>
    readLS(LS_DARK, window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    writeLS(LS_DARK, dark);
  }, [dark]);

  // ── Filters (persisted) ──────────────────────────────────────
  const [showBoys, setShowBoys]   = useState(() => readLS(LS_SHOW_BOYS, true));
  const [showGirls, setShowGirls] = useState(() => readLS(LS_SHOW_GIRLS, true));
  const [showBadge, setShowBadge] = useState(true);

  // ── Names & deck ─────────────────────────────────────────────
  const [deck, setDeck] = useState<NameEntry[]>([]);
  const [deckLoaded, setDeckLoaded] = useState(false);
  // Persist deck position so user can close app and come back
  const [deckPos, setDeckPos] = useState(() => readLS(LS_DECK_POS, 0));

  // Load names after first render so UI shows immediately
  useEffect(() => {
    loadNames().then(all => {
      const filtered = all.filter(n => n.gender === "boy" ? showBoys : showGirls);
      setDeck(filtered);
      setDeckLoaded(true);
    });
  }, []);

  // Rebuild deck when filters change (keep position)
  useEffect(() => {
    if (!namesCache) return;
    const filtered = namesCache.filter(n => n.gender === "boy" ? showBoys : showGirls);
    setDeck(filtered);
    writeLS(LS_SHOW_BOYS, showBoys);
    writeLS(LS_SHOW_GIRLS, showGirls);
  }, [showBoys, showGirls]);

  // Save deck position whenever it changes
  useEffect(() => {
    writeLS(LS_DECK_POS, deckPos);
  }, [deckPos]);

  // ── Liked names (persisted) ──────────────────────────────────
  const [likedNames, setLikedNames] = useState<LikedName[]>(() => readLS(LS_LIKED, []));

  // Persist liked names whenever they change
  useEffect(() => {
    writeLS(LS_LIKED, likedNames);
  }, [likedNames]);

  // ── Swipe history (session only — for undo) ──────────────────
  const [swipeHistory, setSwipeHistory] = useState<{ entry: NameEntry; action: string }[]>([]);
  const [animating, setAnimating] = useState(false);
  const [hintShown, setHintShown] = useState(false);

  // ── Tabs ─────────────────────────────────────────────────────
  const [tab, setTab] = useState<"swipe" | "liked" | "matches">("swipe");

  // ── Liked filters ────────────────────────────────────────────
  const [likedFilter, setLikedFilter] = useState<"all" | "boy" | "girl" | "starred">("all");
  const [searchQ, setSearchQ] = useState("");

  // ── Match notification ───────────────────────────────────────
  const [newMatch, setNewMatch] = useState<MutualMatch | null>(null);
  const [matches, setMatches] = useState<MutualMatch[]>([]);

  // ── Filter sheet ─────────────────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(false);

  // ── Partner activity ─────────────────────────────────────────
  const [partnerActive, setPartnerActive] = useState(false);

  // ── Drag state ───────────────────────────────────────────────
  const dragRef = useRef({ active: false, startX: 0, startY: 0, curX: 0, curY: 0 });
  const topCardRef = useRef<HTMLDivElement>(null);

  // ── Ensure room exists ───────────────────────────────────────
  useQuery({
    queryKey: ["/api/rooms", roomId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rooms/${roomId}`);
      return res.json();
    },
    retry: 3,
  });

  // ── Load initial matches ─────────────────────────────────────
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

  // ── SSE — real-time partner sync ─────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(`/api/rooms/${roomId}/stream`);

      es.addEventListener("connected", () => setPartnerActive(false));

      es.addEventListener("swipe", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        if (data.userId !== getUserId()) {
          setPartnerActive(true);
          setTimeout(() => setPartnerActive(false), 2000);
        }
      });

      es.addEventListener("match", (e) => {
        const match: MutualMatch = JSON.parse((e as MessageEvent).data);
        setMatches(prev => {
          const exists = prev.some(m => m.name === match.name && m.gender === match.gender);
          if (exists) return prev;
          return [match, ...prev];
        });
        setNewMatch(match);
        setTimeout(() => setNewMatch(null), 4000);
        qc.invalidateQueries({ queryKey: ["/api/rooms", roomId, "matches"] });
      });

      es.onerror = () => {
        es.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [roomId]);

  // ── Swipe mutation ───────────────────────────────────────────
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
    onError: () => {
      // Silently ignore swipe errors — likes are saved locally anyway
    },
  });

  // ── Current card ─────────────────────────────────────────────
  const currentEntry = deck[deckPos] ?? null;
  const peek1 = deck[deckPos + 1] ?? null;
  const peek2 = deck[deckPos + 2] ?? null;

  // ── Trigger a swipe ──────────────────────────────────────────
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
      card.classList.add(
        action === "like" ? "swipe-out-right" :
        action === "nope" ? "swipe-out-left" :
        "swipe-out-up"
      );
    }

    // Submit to API (fire-and-forget — likes are saved locally)
    swipeMutation.mutate({ name: entry.name, gender: entry.gender, action });

    setTimeout(() => {
      setDeckPos(p => p + 1);
      setAnimating(false);
    }, 180);
  }, [animating, currentEntry, hintShown, swipeMutation]);

  // ── Undo ─────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (swipeHistory.length === 0 || animating) return;
    const last = swipeHistory[swipeHistory.length - 1];
    setSwipeHistory(h => h.slice(0, -1));
    if (last.action !== "nope") {
      setLikedNames(prev => prev.filter(n =>
        !(n.name === last.entry.name && n.gender === last.entry.gender)
      ));
    }
    setDeckPos(p => Math.max(0, p - 1));
  }, [swipeHistory, animating]);

  // ── Drag handlers ────────────────────────────────────────────
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

  // ── Liked grid filtered ──────────────────────────────────────
  const filteredLiked = likedNames
    .filter(n => {
      if (likedFilter === "boy") return n.gender === "boy";
      if (likedFilter === "girl") return n.gender === "girl";
      if (likedFilter === "starred") return n.starred;
      return true;
    })
    .filter(n => !searchQ || n.name.toLowerCase().includes(searchQ.toLowerCase()));

  const progress = deck.length > 0 ? (deckPos / deck.length) * 100 : 0;
  const remaining = Math.max(0, deck.length - deckPos);
  const genderLabel = showBoys && showGirls ? "Boys & Girls" : showBoys ? "Boy names" : "Girl names";

  // ── Loading skeleton ─────────────────────────────────────────
  if (!deckLoaded) {
    return (
      <div className="flex flex-col h-dvh max-w-[480px] mx-auto bg-background">
        {/* Header skeleton */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="w-24 h-6 rounded-full bg-muted animate-pulse" />
          <div className="w-16 h-8 rounded-full bg-muted animate-pulse" />
          <div className="flex gap-2">
            <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
            <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
          </div>
        </header>
        {/* Tab skeleton */}
        <div className="flex border-b border-border">
          {[1,2,3].map(i => (
            <div key={i} className="flex-1 py-3 flex justify-center">
              <div className="w-16 h-4 rounded-full bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        {/* Card skeleton */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
          <div className="w-full max-w-sm aspect-[3/4] rounded-3xl bg-muted animate-pulse" />
          <div className="flex gap-5">
            {[52,52,72,52].map((sz, i) => (
              <div key={i} className={`w-[${sz}px] h-[${sz}px] rounded-full bg-muted animate-pulse`}
                style={{ width: sz, height: sz }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh max-w-[480px] mx-auto overflow-hidden bg-background relative">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 pt-safe border-b border-border flex-shrink-0 bg-background/95 backdrop-blur-sm">
        {/* App name */}
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-primary fill-primary" />
          <span className="font-bold text-base" style={{ fontFamily: "var(--font-display)" }}>
            NameSwipe
          </span>
        </div>

        {/* Partner indicator */}
        <div className="flex items-center gap-1.5">
          {partnerActive ? (
            <span className="text-xs bg-green-500/15 text-green-600 dark:text-green-400 px-2.5 py-1 rounded-full font-semibold animate-pulse">
              ● Partner active
            </span>
          ) : (
            <span className="text-xs text-muted-foreground px-2.5 py-1 rounded-full border border-border font-medium">
              👫 Couples mode
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
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
            className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${
              tab === t ? "text-primary border-primary" : "text-muted-foreground border-transparent"
            }`}
          >
            {t === "swipe" && "Discover"}
            {t === "liked" && `Saved (${likedNames.length})`}
            {t === "matches" && (
              <span className="flex items-center justify-center gap-1">
                <Trophy className="w-3.5 h-3.5" />
                Matches{matches.length > 0 && (
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
                  key={`${currentEntry.name}-${currentEntry.gender}-${deckPos}`}
                  ref={topCardRef}
                  className="absolute inset-x-0 card-shadow rounded-3xl bg-card border border-border flex flex-col items-center justify-center gap-4 p-8 cursor-grab active:cursor-grabbing select-none pop-in"
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
                  <div className="stamp-like absolute top-8 left-6 border-[3px] border-green-500 text-green-500 rounded-lg px-3 py-1 font-bold text-lg rotate-[-12deg] opacity-0 pointer-events-none"
                    style={{ fontFamily: "var(--font-display)" }}>
                    SAVE ❤️
                  </div>
                  <div className="stamp-nope absolute top-8 right-6 border-[3px] border-rose-500 text-rose-500 rounded-lg px-3 py-1 font-bold text-lg rotate-[12deg] opacity-0 pointer-events-none"
                    style={{ fontFamily: "var(--font-display)" }}>
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

                  {/* Name meaning */}
                  {currentEntry.meaning && (
                    <p className="text-center text-sm text-muted-foreground px-4 leading-relaxed italic max-w-[260px]">
                      {currentEntry.meaning}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Swipe hint */}
          {!hintShown && currentEntry && (
            <div className="flex justify-center gap-6 text-xs text-muted-foreground/60 flex-shrink-0">
              <span>← Skip</span>
              <span>❤️ Save →</span>
              <span>↑ Star</span>
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
                        setLikedNames(prev => prev.filter(p =>
                          !(p.name === n.name && p.gender === n.gender)
                        ));
                      }}
                    >✕</button>
                    <div className="font-bold text-xl leading-tight mt-1" style={{ fontFamily: "var(--font-display)" }}>
                      {n.name}
                    </div>
                    <span className={`mt-2 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      n.gender === "boy"
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                        : "bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400"
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
                  Send your partner the same link and start swiping — names you both save appear here instantly!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-3">
                {matches.map((m, i) => (
                  <div
                    key={`${m.name}-${m.gender}`}
                    className="pop-in relative bg-gradient-to-br from-rose-50 to-amber-50 dark:from-rose-900/20 dark:to-amber-900/20 border border-rose-200 dark:border-rose-700/50 rounded-2xl p-4"
                    style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
                  >
                    {(m.user1Super || m.user2Super) && (
                      <span className="absolute top-2 right-2 text-sm">⭐</span>
                    )}
                    <div className="font-bold text-xl leading-tight" style={{ fontFamily: "var(--font-display)" }}>
                      {m.name}
                    </div>
                    <span className={`mt-2 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      m.gender === "boy"
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                        : "bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400"
                    }`}>
                      {m.gender === "boy" ? "👦 Boy" : "👧 Girl"}
                    </span>
                    <div className="mt-2 flex items-center gap-1">
                      <Heart className="w-3 h-3 text-rose-400 fill-rose-400" />
                      <span className="text-xs text-muted-foreground font-medium">Both saved!</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Filter sheet ─────────────────────────────────────── */}
      {filterOpen && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end" onClick={() => setFilterOpen(false)}>
          <div
            className="bg-card border-t border-border rounded-t-3xl p-6 space-y-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-muted mx-auto" />
            <h3 className="font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>Filters</h3>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Show names for</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowBoys(b => !b)}
                    className={`flex-1 py-3 rounded-2xl border-2 font-semibold text-sm transition-all ${
                      showBoys ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "border-border text-muted-foreground"
                    }`}
                  >
                    👦 Boy Names
                  </button>
                  <button
                    onClick={() => setShowGirls(g => !g)}
                    className={`flex-1 py-3 rounded-2xl border-2 font-semibold text-sm transition-all ${
                      showGirls ? "border-primary bg-rose-50 dark:bg-rose-900/20 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    👧 Girl Names
                  </button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Card options</p>
                <button
                  onClick={() => setShowBadge(b => !b)}
                  className={`w-full py-3 rounded-2xl border-2 font-semibold text-sm transition-all ${
                    showBadge ? "border-primary bg-rose-50 dark:bg-rose-900/20 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {showBadge ? "✓" : "○"} Show gender badge on card
                </button>
              </div>
            </div>

            <Button className="w-full rounded-2xl h-12" onClick={() => setFilterOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
