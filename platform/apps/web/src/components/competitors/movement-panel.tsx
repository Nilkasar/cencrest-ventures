"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@bebest/ui";
import { getCompetitorMovement } from "@/data/competitive-intelligence/client";
import { MOVEMENT_DIRECTION_BADGE_VARIANT, MOVEMENT_DIRECTION_LABEL } from "@/data/competitive-intelligence/labels";
import type { MovementResult } from "@/data/competitive-intelligence/types";
import type { Competitor } from "@/data/types";

type RowState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "success"; result: MovementResult };

/**
 * Movement alerts, per the epic spec's own instruction: "build the
 * comparison logic now, wire the actual schedule trigger in Epic 12" —
 * `GET .../movement` (comparing a competitor's two most recent completed
 * runs) is real, already built, and exposed here on demand. What does NOT
 * exist is a proactive feed: nothing watches for a competitor's score
 * changing and pushes a notification, because that requires Epic 12's
 * scheduled Competitor Agent. The empty-state note below names that
 * honestly instead of a synthesized "CompetitorA just moved" alert that
 * never actually happened.
 */
export function MovementPanel({ competitors }: { competitors: Competitor[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({});

  async function check(competitorId: string) {
    setRows((prev) => ({ ...prev, [competitorId]: { status: "loading" } }));
    try {
      const result = await getCompetitorMovement(competitorId);
      setRows((prev) => ({ ...prev, [competitorId]: { status: "success", result } }));
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [competitorId]: { status: "error", message: err instanceof Error ? err.message : "Couldn't check movement." },
      }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movement</CardTitle>
        <CardDescription>How each competitor&apos;s AI Visibility Score is trending run over run.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <EmptyState
          compact
          icon={<TrendingUp size={18} />}
          title="No automatic alerts yet"
          description="Proactive movement alerts (“CompetitorA just increased their AI visibility by 15 points”) ship with Epic 12's Competitor Agent, once runs are on a schedule. Until then, check any competitor's trend on demand below."
        />

        {competitors.length === 0 ? null : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
            {competitors.map((competitor) => (
              <MovementRow key={competitor.id} competitor={competitor} state={rows[competitor.id] ?? { status: "idle" }} onCheck={() => void check(competitor.id)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MovementRow({ competitor, state, onCheck }: { competitor: Competitor; state: RowState; onCheck: () => void }) {
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-foreground">{competitor.name}</p>
        <Button variant="outline" size="sm" loading={state.status === "loading"} onClick={onCheck}>
          Check movement
        </Button>
      </div>

      {state.status === "error" && <p className="text-[12.5px] text-danger">{state.message}</p>}

      {state.status === "success" && (
        <MovementResultLine result={state.result} />
      )}
    </div>
  );
}

function MovementResultLine({ result }: { result: MovementResult }) {
  if (result.sentence === null || result.direction === null) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {result.latestScore === null
          ? "No completed run yet for this competitor."
          : "Only one completed run so far — check back after the next one to see a trend."}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={MOVEMENT_DIRECTION_BADGE_VARIANT[result.direction]} size="sm">
        {MOVEMENT_DIRECTION_LABEL[result.direction]}
      </Badge>
      <p className="text-[13px] text-foreground">{result.sentence}</p>
    </div>
  );
}
