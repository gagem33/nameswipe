import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import RoomPage from "@/pages/room";
import NotFound from "@/pages/not-found";

// The single shared room — no codes needed
const ROOM = "COUPLE";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Switch>
          {/* Redirect root to the shared room */}
          <Route path="/">
            <Redirect to={`/room/${ROOM}`} />
          </Route>
          <Route path="/room/:code" component={RoomPage} />
          <Route component={NotFound} />
        </Switch>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
