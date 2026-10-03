"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Minus, Radar, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Card, Skeleton, cn, easings } from "@bebest/ui";
import type { AsyncState } from "@/lib/use-async-data";
import { getAiRunProviderSummary, getAiRunScore } from "@/data/ai-visibility/client";
import type { AiRun, AiRunProviderSummaryRow, AiRunScore, ScoreComponentKey } from "@/data/ai-visibility/types";
import { SCORE_COMPONENT_DESCRIPTION, SCORE_COMPONENT_LABEL } from "@/data/ai-visibility/labels";
import { formatRelativeTime } from "@/lib/format";
import { polar, r2 } from "./chart-math";
import { DEFAULT_PROVIDERS, modelMeta } from "./models";
import { AnimatedNumber, LiveChip, PanelError, SrTable, panelVariants, useOffscreenPause, usePolledData } from "./primitives";

/**
 * The Overview's centerpiece — "How am I doing in AI answers?" at a glance.
 *
 * Left: a live constellation. Each AI assistant the brand's run actually
 * queried (`AiRun.providers`) is a node; its outer ring is that model's
 * real mention rate (`GET /ai-runs/:id/provider-summary`), and signals
 * travel down its wire into the AI Visibility Score dial. Signal cadence is
 * data, not decoration: a model that mentions the brand more often fires
 * more often; a model with no extracted answers yet stays dark with a
 * dashed wire. While a baseline is running the whole field is live —
 * counts poll every 8s and the dial wears the run's real progress ring.
 *
 * Right: the score's anatomy — the four weighted formula components from
 * `GET /ai-runs/:id/score`, each bar showing its real value and its
 * weighted contribution, so the number "shows its work" instead of sitting
 * there opaque. The delta compares the two most recent COMPLETED runs —
 * never a synthesized change.
 */

const VB = { w: 640, h: 400 };
const DIAL = { cx: 320, cy: 200, r: 82 };
const TICKS = 72;
const COMPONENT_ORDER: ScoreComponentKey[] = ["mentionScore", "recommendationScore", "positionScore", "coverageScore"];

type RunsState = AsyncState<AiRun[]> & { reload: () => void };

export function SignalDeck({ runs }: { runs: RunsState }) {
  return (
    <motion.section variants={panelVariants} aria-label="AI Visibility command center">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 ov-glow ov-breathe" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 ov-grid" aria-hidden="true" />
        <div className="relative">
          {runs.status === "loading" && <DeckSkeleton />}
          {runs.status === "error" && (
            <div className="p-8">
              <PanelError message="Your AI Visibility runs couldn’t load right now." onRetry={runs.reload} height={320} />
            </div>
          )}
          {runs.status === "success" && <DeckBody runs={runs.data} />}
        </div>
      </Card>
    </motion.section>
  );
}

function DeckBody({ runs }: { runs: AiRun[] }) {
  const brandRuns = runs.filter((r) => r.competitorId === null);
  const latest = brandRuns[0] ?? null;
  const completed = brandRuns.filter((r) => r.status === "completed" && r.aiVisibilityScore !== null);
  const current = completed[0] ?? null;
  const previous = completed[1] ?? null;
  const active = latest && (latest.status === "queued" || latest.status === "running") ? latest : null;
  const nodeRun = active ?? current;

  const detail = usePolledData(
    async () => {
      const [score, summary] = await Promise.all([
        current ? getAiRunScore(current.id) : Promise.resolve(null),
        // Per-model counts are additive; a failure there degrades the
        // nodes to "—" without taking the score anatomy down with it.
        nodeRun ? getAiRunProviderSummary(nodeRun.id).catch(() => "unavailable" as const) : Promise.resolve(null),
      ]);
      return { score, summary };
    },
    [current?.id, nodeRun?.id],
    () => (active ? 8000 : null),
  );

  const providers = nodeRun?.providers.length ? nodeRun.providers : DEFAULT_PROVIDERS;
  const summary = detail.status === "success" && detail.data.summary && detail.data.summary !== "unavailable" ? detail.data.summary.providers : null;
  const summaryUnavailable = detail.status === "success" && detail.data.summary === "unavailable";
  const scoreDetail = detail.status === "success" ? detail.data.score : null;
  const score = current?.aiVisibilityScore ?? null;
  const delta = current && previous ? r2(current.aiVisibilityScore! - previous.aiVisibilityScore!) : null;

  return (
    <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Constellation */}
      <div className="p-4 sm:p-6 @4xl:pr-2">
        <Constellation providers={providers} summary={summary} score={score} activeRun={active} />
        <ModelLegend providers={providers} summary={summary} unavailable={summaryUnavailable} loading={detail.status === "loading" && !!nodeRun} hasRun={!!nodeRun} />
      </div>

      {/* Anatomy */}
      <div className="p-5 sm:p-7 @4xl:pl-4 flex flex-col gap-5 border-t border-border @4xl:border-t-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex size-7 items-center justify-center rounded-md bg-accent-muted text-accent" aria-hidden="true">
            <Radar size={14} />
          </span>
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">AI Visibility Score</p>
          {active && <LiveChip label={active.status === "queued" ? "Queued" : `Running · ${active.progressPct}%`} />}
        </div>

        {!current && !active && latest?.status !== "failed" && <FirstRunCallout />}
        {!current && latest?.status === "failed" && !active && (
          <div className="flex flex-col gap-3">
            <p className="font-display text-[22px] font-semibold text-foreground leading-tight">Your last run didn’t finish</p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">{latest.error ?? "The run failed before a score could be computed."} Open AI Visibility to see why and retry.</p>
            <Button asChild variant="primary" size="sm" className="self-start">
              <Link href="/ai-visibility">Review and retry</Link>
            </Button>
          </div>
        )}
        {!current && active && (
          <div className="flex flex-col gap-2">
            <p className="font-display text-[22px] font-semibold text-foreground leading-tight">Your baseline is being measured</p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {active.completedJobs + active.failedJobs} of {active.totalJobs.toLocaleString("en-US")} AI answers collected. You can leave — this
              page updates itself, and you’ll be notified when the score lands.
            </p>
          </div>
        )}

        {current && score !== null && (
          <>
            <div>
              <p className="text-[13px] text-muted-foreground">
                {scoreDetail?.breakdown.mentionScore.value != null ? (
                  <>
                    AI assistants mention you in{" "}
                    <span className="font-semibold text-foreground">{scoreDetail.breakdown.mentionScore.value.toFixed(0)}%</span> of answers
                  </>
                ) : (
                  "Your composite visibility across AI assistants"
                )}
              </p>
              <div className="mt-1 flex items-end gap-3 flex-wrap">
                <p className="font-display text-[44px] leading-none font-semibold text-foreground tracking-[-0.03em]">
                  <AnimatedNumber value={score} format={(v) => v.toFixed(1)} />
                  <span className="ml-1 font-sans text-[15px] font-normal text-subtle-foreground tracking-normal">/100</span>
                </p>
                <DeltaChip delta={delta} />
              </div>
            </div>

            <div className="flex flex-col gap-3.5" aria-label="Score breakdown">
              {detail.status === "loading" &&
                COMPONENT_ORDER.map((k) => (
                  <div key={k} className="flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-1.5 w-full" />
                  </div>
                ))}
              {detail.status === "error" && <PanelError message="The score breakdown couldn’t load." onRetry={detail.reload} />}
              {scoreDetail && <ScoreAnatomy score={scoreDetail} />}
            </div>
          </>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 flex-wrap pt-1">
          <p className="font-mono text-[10.5px] text-subtle-foreground leading-relaxed">
            {current
              ? `${current.totalJobs.toLocaleString("en-US")} answers · ${current.providers.length} models · formula v${current.scoringFormulaVersion ?? "—"} · ${current.completedAt ? formatRelativeTime(current.completedAt) : ""}`
              : "Evidence-backed: every point traces to a real AI answer."}
          </p>
          {current && (
            <Link
              href="/ai-visibility"
              className="group inline-flex items-center gap-1 h-9 rounded-md px-2 -mr-2 text-[12.5px] font-medium text-accent hover:bg-accent-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Trace the evidence
              <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function FirstRunCallout() {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-[24px] font-semibold text-foreground leading-tight tracking-[-0.01em]">
        See what ChatGPT, Claude, Gemini and Perplexity say about you
      </p>
      <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[46ch]">
        No visibility scan has run yet, so there’s no score to show. Your first run asks every model your real buyer questions —
        about 20–60 minutes, in the background. Leave whenever you like; this dial fills in when it lands.
      </p>
      <Button asChild variant="primary" size="md" className="self-start">
        <Link href="/ai-visibility">Run your first visibility scan</Link>
      </Button>
    </div>
  );
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="mb-1 text-[11.5px] text-subtle-foreground">Run again to see a trend</span>;
  }
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <Badge variant={delta > 0 ? "success" : delta < 0 ? "danger" : "neutral"} className="mb-1.5">
      <Icon size={12} aria-hidden="true" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)} vs previous run
    </Badge>
  );
}

function ScoreAnatomy({ score }: { score: AiRunScore }) {
  if (!score.computed) {
    return <p className="text-[12.5px] text-muted-foreground">The formula breakdown is still being aggregated.</p>;
  }
  return (
    <>
      {COMPONENT_ORDER.map((key, i) => {
        const c = score.breakdown[key];
        const value = c.value ?? 0;
        return (
          <div key={key} className="group">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[12.5px] font-medium text-foreground" title={SCORE_COMPONENT_DESCRIPTION[key]}>
                {SCORE_COMPONENT_LABEL[key].replace(" Score", "")}
                <span className="ml-1.5 font-mono text-[10.5px] font-normal text-subtle-foreground">×{c.weight}</span>
              </p>
              <p className="font-mono text-[12px] text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {c.value === null ? "—" : value.toFixed(1)}
                {c.weightedContribution !== null && (
                  <span className="ml-2 text-subtle-foreground">+{c.weightedContribution.toFixed(1)} pts</span>
                )}
              </p>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-surface overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-accent origin-left"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(value, 100) / 100 }}
                transition={{ duration: 1.1, delay: 0.25 + i * 0.09, ease: easings.emphasized }}
              />
            </div>
            <p className="mt-1 text-[11.5px] text-subtle-foreground leading-snug">{SCORE_COMPONENT_DESCRIPTION[key]}</p>
          </div>
        );
      })}
      <p className="font-mono text-[10.5px] text-subtle-foreground break-words">{score.formula}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Constellation

const TICK_GEOMETRY = Array.from({ length: TICKS }, (_, t) => {
  const deg = (t / TICKS) * 360;
  const major = t % 6 === 0;
  const [x1, y1] = polar(DIAL.cx, DIAL.cy, DIAL.r + 12, deg);
  const [x2, y2] = polar(DIAL.cx, DIAL.cy, DIAL.r + (major ? 21 : 17), deg);
  return { major, x1, y1, x2, y2 };
});

function nodePositions(n: number): [number, number][] {
  const left = Math.ceil(n / 2);
  const right = n - left;
  const col = (count: number, x: number) =>
    Array.from({ length: count }, (_, i): [number, number] => [x, count === 1 ? DIAL.cy : 88 + (224 * i) / (count - 1)]);
  return [...col(left, 92), ...col(right, VB.w - 92)];
}

function wirePath([x, y]: [number, number]): string {
  const dir = x < DIAL.cx ? 1 : -1;
  const angle = (Math.atan2(y - DIAL.cy, x - DIAL.cx) * 180) / Math.PI + 90;
  const [ex, ey] = polar(DIAL.cx, DIAL.cy, DIAL.r + 26, angle);
  const [c2x, c2y] = polar(DIAL.cx, DIAL.cy, DIAL.r + 110, angle);
  const sx = x + dir * 46;
  return `M${sx} ${y} C ${sx + dir * 80} ${y}, ${c2x} ${c2y}, ${ex} ${ey}`;
}

function Constellation({
  providers,
  summary,
  score,
  activeRun,
}: {
  providers: string[];
  summary: AiRunProviderSummaryRow[] | null;
  score: number | null;
  activeRun: AiRun | null;
}) {
  const { ref, paused } = useOffscreenPause<HTMLDivElement>();
  const positions = nodePositions(providers.length);
  const rows = new Map(summary?.map((r) => [r.provider, r]) ?? []);
  const scoreFrac = score === null ? 0 : Math.min(score, 100) / 100;
  const progressFrac = activeRun ? activeRun.progressPct / 100 : null;
  const [kx, ky] = polar(DIAL.cx, DIAL.cy, DIAL.r, scoreFrac * 360);

  const label =
    score === null
      ? `AI Visibility constellation: ${providers.map((p) => modelMeta(p).name).join(", ")}. No completed score yet.`
      : `AI Visibility Score ${score.toFixed(1)} out of 100. ${providers
          .map((p) => {
            const r = rows.get(p);
            return `${modelMeta(p).name}: ${r?.mentionRatePct != null ? `${r.mentionRatePct}% of answers mention you` : "no data yet"}`;
          })
          .join("; ")}.`;

  return (
    <div ref={ref} data-paused={paused} className="@container relative w-full aspect-[640/400]" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <radialGradient id="ov-dial-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.22 }} />
            <stop offset="65%" style={{ stopColor: "var(--accent)", stopOpacity: 0.04 }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="ov-dial-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--color-verdant-600)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-verdant-300)" }} />
          </linearGradient>
          <filter id="ov-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>

        <circle className="ov-breathe" cx={DIAL.cx} cy={DIAL.cy} r={170} fill="url(#ov-dial-glow)" />

        {/* wires + signals */}
        {providers.map((p, i) => {
          const meta = modelMeta(p);
          const row = rows.get(p);
          const d = wirePath(positions[i]!);
          const rate = row?.mentionRatePct ?? null;
          const live = (rate !== null && rate > 0) || (activeRun !== null && (row?.responses ?? 0) > 0);
          // Stronger signal -> faster cadence: 5.2s at 0% down to 2.2s at 100%.
          const dur = `${r2(5.2 - ((rate ?? 20) / 100) * 3)}s`;
          const delay = `${r2(i * 0.65)}s`;
          return (
            <g key={p}>
              <motion.path
                d={d}
                fill="none"
                className="stroke-border-strong"
                strokeWidth={1.2}
                strokeDasharray={live ? undefined : "3 5"}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.1, delay: 0.3 + i * 0.1, ease: easings.emphasized }}
              />
              {live && (
                <>
                  <path d={d} pathLength={100} fill="none" className="ov-comet" stroke={meta.tint} strokeWidth={5} strokeLinecap="round" filter="url(#ov-blur)" style={{ ["--ov-dur" as string]: dur, ["--ov-delay" as string]: delay }} />
                  <path d={d} pathLength={100} fill="none" className="ov-comet" stroke={meta.tint} strokeWidth={1.8} strokeLinecap="round" style={{ ["--ov-dur" as string]: dur, ["--ov-delay" as string]: delay }} />
                </>
              )}
            </g>
          );
        })}

        {/* model nodes */}
        {providers.map((p, i) => {
          const meta = modelMeta(p);
          const row = rows.get(p);
          const [x, y] = positions[i]!;
          const rate = row?.mentionRatePct ?? null;
          return (
            <motion.g
              key={p}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.15 + i * 0.08, ease: easings.emphasized }}
              style={{ transformOrigin: `${x}px ${y}px` }}
            >
              {rate !== null && rate > 0 && <circle className="ov-pulse" cx={x} cy={y} r={40} fill="none" stroke={meta.tint} strokeWidth={1} style={{ animationDelay: `${i * 0.6}s` }} />}
              <circle cx={x} cy={y} r={34} className="fill-surface-raised stroke-border" strokeWidth={1} />
              <circle cx={x} cy={y} r={40} fill="none" className="stroke-border" strokeWidth={3} />
              {rate !== null && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={40}
                  fill="none"
                  stroke={meta.tint}
                  strokeWidth={3}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${x} ${y})`}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: Math.max(rate / 100, 0.001) }}
                  transition={{ duration: 1.2, delay: 0.6 + i * 0.1, ease: easings.emphasized }}
                />
              )}
              <circle cx={x} cy={y} r={15} fill={meta.tint} fillOpacity={0.14} stroke={meta.tint} strokeOpacity={0.6} />
              <text x={x} y={y + 4.5} textAnchor="middle" fill={meta.tint} fontSize={13} fontWeight={700} style={{ fontFamily: "var(--font-sans)" }}>
                {meta.glyph}
              </text>
            </motion.g>
          );
        })}

        {/* dial */}
        <motion.g
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.2, ease: easings.emphasized }}
          style={{ transformOrigin: `${DIAL.cx}px ${DIAL.cy}px` }}
        >
          <circle className="ov-spin stroke-border-strong" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r + 40} fill="none" strokeDasharray="1 8" strokeLinecap="round" strokeWidth={1.4} />
          <g className="ov-spin-rev">
            <circle cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r + 54} fill="none" className="stroke-border" strokeWidth={1} />
            {[0, 120, 240].map((deg) => {
              const [sx, sy] = polar(DIAL.cx, DIAL.cy, DIAL.r + 54, deg);
              return <circle key={deg} cx={sx} cy={sy} r={2.2} style={{ fill: "var(--accent)" }} opacity={0.7} />;
            })}
          </g>

          {TICK_GEOMETRY.map(({ major, x1, y1, x2, y2 }, t) => {
            const lit = score !== null && t / TICKS < scoreFrac;
            return lit ? (
              <motion.line
                key={t}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                style={{ stroke: "var(--accent)" }}
                strokeWidth={major ? 1.6 : 1.1}
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: major ? 1 : 0.7 }}
                transition={{ duration: 0.25, delay: 0.5 + (t / TICKS) * 1.3 }}
              />
            ) : (
              <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-border" strokeWidth={major ? 1.4 : 1} strokeLinecap="round" />
            );
          })}

          {score !== null && <circle className="ov-pulse" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.5} />}
          <circle cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} className="fill-surface-raised stroke-border" strokeWidth={9} />
          {score !== null && (
            <motion.circle
              cx={DIAL.cx}
              cy={DIAL.cy}
              r={DIAL.r}
              fill="none"
              stroke="url(#ov-dial-arc)"
              strokeWidth={9}
              strokeLinecap="round"
              transform={`rotate(-90 ${DIAL.cx} ${DIAL.cy})`}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(scoreFrac, 0.001) }}
              transition={{ duration: 1.6, delay: 0.45, ease: easings.emphasized }}
            />
          )}
          {score !== null && (
            <motion.circle
              cx={kx}
              cy={ky}
              r={6.5}
              className="fill-surface-raised"
              style={{ stroke: "var(--accent)" }}
              strokeWidth={3}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 1.9 }}
            />
          )}
          {progressFrac !== null && (
            <motion.circle
              cx={DIAL.cx}
              cy={DIAL.cy}
              r={DIAL.r - 14}
              fill="none"
              style={{ stroke: "var(--color-info-500)" }}
              strokeWidth={3}
              strokeLinecap="round"
              transform={`rotate(-90 ${DIAL.cx} ${DIAL.cy})`}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(progressFrac, 0.001) }}
              transition={{ duration: 0.8, ease: easings.emphasized }}
            />
          )}
        </motion.g>
      </svg>

      {/* Centre readout — HTML so the numeral stays crisp and counts up. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center text-center" aria-hidden="true">
        {score !== null ? (
          <>
            <AnimatedNumber value={score} format={(v) => v.toFixed(0)} className="font-display text-[clamp(26px,6.2cqi,46px)] font-semibold leading-none text-foreground tracking-[-0.03em]" />
            <span className="mt-1 font-mono text-[clamp(8px,1.6cqi,10px)] uppercase tracking-[0.16em] text-subtle-foreground">AVS / 100</span>
          </>
        ) : activeRun ? (
          <>
            <AnimatedNumber value={activeRun.progressPct} format={(v) => `${v.toFixed(0)}%`} className="font-display text-[clamp(22px,5cqi,36px)] font-semibold leading-none text-foreground" />
            <span className="mt-1 font-mono text-[clamp(8px,1.6cqi,10px)] uppercase tracking-[0.16em] text-subtle-foreground">Measuring</span>
          </>
        ) : (
          <>
            <span className="font-display text-[clamp(26px,6cqi,44px)] font-semibold leading-none text-subtle-foreground">—</span>
            <span className="mt-1 font-mono text-[clamp(8px,1.6cqi,10px)] uppercase tracking-[0.16em] text-subtle-foreground">No score yet</span>
          </>
        )}
      </div>

      {/* Node captions (hidden on narrow screens — the legend below carries them). */}
      {providers.map((p, i) => {
        const [x, y] = positions[i]!;
        const row = rows.get(p);
        return (
          <div
            key={p}
            className="pointer-events-none absolute hidden sm:flex -translate-x-1/2 flex-col items-center text-center"
            style={{ left: `${(x / VB.w) * 100}%`, top: `${((y + 48) / VB.h) * 100}%` }}
            aria-hidden="true"
          >
            <span className="text-[12px] font-semibold text-foreground leading-tight">{modelMeta(p).name}</span>
            <span className="font-mono text-[10.5px] text-muted-foreground leading-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
              {row?.mentionRatePct != null ? `${row.mentionRatePct.toFixed(0)}% mention` : row && row.responses > 0 ? "extracting…" : "awaiting run"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ModelLegend({
  providers,
  summary,
  unavailable,
  loading,
  hasRun,
}: {
  providers: string[];
  summary: AiRunProviderSummaryRow[] | null;
  unavailable: boolean;
  loading: boolean;
  hasRun: boolean;
}) {
  if (!hasRun) return null;
  const rows = new Map(summary?.map((r) => [r.provider, r]) ?? []);
  return (
    <div className="mt-3">
      <ul className="grid grid-cols-2 @2xl:grid-cols-4 gap-2">
        {providers.map((p) => {
          const meta = modelMeta(p);
          const row = rows.get(p);
          return (
            <li key={p} className="rounded-lg border border-border bg-surface-raised/70 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full shrink-0" style={{ background: meta.tint }} aria-hidden="true" />
                <span className="text-[12px] font-medium text-foreground truncate">{meta.name}</span>
              </div>
              {loading ? (
                <Skeleton className="mt-1.5 h-3 w-20" />
              ) : (
                <dl className="mt-1 grid grid-cols-2 gap-x-2 font-mono text-[10.5px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <dt className="sr-only">Mentioned</dt>
                  <dd className={cn(row?.mentionRatePct == null && "text-subtle-foreground")}>
                    {row?.mentionRatePct != null ? `${row.mentionRatePct.toFixed(0)}% ment.` : "—"}
                  </dd>
                  <dt className="sr-only">Recommended</dt>
                  <dd className={cn(row?.recommendationRatePct == null && "text-subtle-foreground")}>
                    {row?.recommendationRatePct != null ? `${row.recommendationRatePct.toFixed(0)}% rec.` : "—"}
                  </dd>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {unavailable && <p className="mt-2 text-[11.5px] text-subtle-foreground">Per-model counts are temporarily unavailable.</p>}
      {summary && (
        <SrTable
          caption="AI Visibility by model"
          head={["Model", "Answers", "Mention rate", "Recommendation rate"]}
          rows={summary.map((r) => [
            modelMeta(r.provider).name,
            r.responses,
            r.mentionRatePct == null ? "no data" : `${r.mentionRatePct}%`,
            r.recommendationRatePct == null ? "no data" : `${r.recommendationRatePct}%`,
          ])}
        />
      )}
    </div>
  );
}

function DeckSkeleton() {
  return (
    <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6 p-6" aria-busy="true">
      <span className="sr-only">Loading AI Visibility…</span>
      <div className="relative aspect-[640/400] flex items-center justify-center">
        <Skeleton className="size-[42%] rounded-full" />
      </div>
      <div className="flex flex-col gap-4 py-4">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-12 w-40" />
        {COMPONENT_ORDER.map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
