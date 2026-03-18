import { useState } from "react";
import { useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Heart, Users, Sparkles, ArrowRight } from "lucide-react";

export default function HomePage() {
  const [, navigate] = useLocation();
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState<"create" | "join" | null>(null);
  const { toast } = useToast();

  async function createRoom() {
    setLoading("create");
    try {
      const room = await apiRequest("POST", "/api/rooms");
      const data = await room.json();
      navigate(`/room/${data.id}`);
    } catch {
      toast({ title: "Couldn't create room", variant: "destructive" });
      setLoading(null);
    }
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setLoading("join");
    try {
      const res = await apiRequest("GET", `/api/rooms/${code}`);
      if (!res.ok) {
        toast({ title: `Room "${code}" not found`, description: "Check the code and try again.", variant: "destructive" });
        setLoading(null);
        return;
      }
      navigate(`/room/${code}`);
    } catch {
      toast({ title: "Couldn't join room", variant: "destructive" });
      setLoading(null);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-between bg-background px-6 py-10 pt-safe">

      {/* Logo + hero */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 text-center max-w-sm w-full">

        {/* Icon */}
        <div className="relative">
          <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-pink-400 to-rose-600 flex items-center justify-center shadow-xl shadow-rose-200 dark:shadow-rose-900/40">
            <Heart className="w-12 h-12 text-white fill-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-xs shadow-md">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            NameSwipe
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            Tinder for baby names — swipe together with your partner and discover names you both love.
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 justify-center">
          {["20,000 names", "Real-time sync", "Mutual matches"].map(f => (
            <span key={f} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-accent text-accent-foreground border border-border">
              {f}
            </span>
          ))}
        </div>

        {/* Create room */}
        <div className="w-full space-y-3">
          <Button
            data-testid="button-create-room"
            className="w-full h-14 text-base font-bold rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-rose-200 dark:shadow-rose-900/30 gap-2"
            onClick={createRoom}
            disabled={!!loading}
          >
            {loading === "create" ? (
              <span className="flex items-center gap-2"><span className="animate-spin">⏳</span> Creating…</span>
            ) : (
              <><Users className="w-5 h-5" /> Create a Room</>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">You'll get a code to share with your partner</p>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">or join existing</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Join room */}
        <div className="w-full space-y-3">
          <div className="flex gap-2">
            <Input
              data-testid="input-join-code"
              placeholder="Enter room code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && joinRoom()}
              className="h-12 text-base font-bold tracking-widest text-center uppercase rounded-xl"
              maxLength={8}
            />
            <Button
              data-testid="button-join-room"
              className="h-12 px-5 rounded-xl"
              onClick={joinRoom}
              disabled={!joinCode.trim() || !!loading}
              variant="outline"
            >
              {loading === "join" ? "…" : <ArrowRight className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pt-6">
        <a
          href="https://www.perplexity.ai/computer"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground/60 hover:text-primary transition-colors"
        >
          Created with Perplexity Computer
        </a>
      </div>

    </div>
  );
}
