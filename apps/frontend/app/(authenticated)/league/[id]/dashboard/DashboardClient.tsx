"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { League, DashboardTeam, StandingEntry } from "@/types";
import TeamHeader from "../components/TeamHeader";
import MovieTimeline from "../components/MovieTimeline";
import StandingsSidebar from "../components/StandingsSidebar";

interface Props {
  league: League;
  userTeam: DashboardTeam | null;
  standings: StandingEntry[];
  totalTeams: number;
}

export default function DashboardClient({
  league: initialLeague,
  userTeam,
  standings,
  totalTeams,
}: Props) {
  const [league, setLeague] = useState(initialLeague);

  const supabase = useMemo(() => createClient(), []);
  const channelIdRef = useRef(0);

  // Real-time subscription for score updates
  useEffect(() => {
    channelIdRef.current++;
    const channelId = channelIdRef.current;

    const channel = supabase
      .channel(`dashboard-${league.id}-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "team_scores",
        },
        () => {
          // TODO: Implement data refetch when scores update (e.g., router.refresh())
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "movies",
        },
        () => {
          // TODO: Implement data refetch when movie scores are calculated
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leagues",
          filter: `id=eq.${league.id}`,
        },
        (payload) => {
          setLeague(payload.new as League);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [league.id, supabase]);

  // Empty state for when user has no team yet
  if (!userTeam) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card p-8 text-center">
            <h2 className="text-xl font-display font-semibold text-foreground mb-2">
              Welcome to {league.name}
            </h2>
            <p className="text-foreground-muted">
              {league.status === "setup"
                ? "Waiting for the draft to begin..."
                : "Your team will appear here once you join the draft."}
            </p>
          </div>
        </div>
        <div>
          <StandingsSidebar leagueId={league.id} standings={standings} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Content */}
      <div className="lg:col-span-2 space-y-6">
        <TeamHeader team={userTeam} totalTeams={totalTeams} />
        <MovieTimeline movies={userTeam.movies} leagueStatus={league.status} />
      </div>

      {/* Sidebar */}
      <div>
        <StandingsSidebar leagueId={league.id} standings={standings} />
      </div>
    </div>
  );
}
