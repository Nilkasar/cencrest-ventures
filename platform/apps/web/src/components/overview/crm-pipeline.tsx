"use client";

import { motion } from "framer-motion";
import { Handshake } from "lucide-react";
import { cn, easings } from "@bebest/ui";
import { ApiError } from "@/lib/api-client";
import { useAsyncData } from "@/lib/use-async-data";
import { fetchDeals, fetchLeads } from "@/data/crm/client";
import { DEAL_STAGE_LABEL, LEAD_STATUS_SEQUENCE, type Deal, type DealStage, type LeadStatus } from "@/data/crm/types";
import { formatCompactCurrency } from "@/lib/format";
import { r2 } from "./chart-math";
import { AnimatedNumber, Panel, PanelEmpty, PanelError, PanelSkeleton, SrTable, useOffscreenPause } from "./primitives";

/**
 * BeBest's own revenue pipeline — only for the internal operations
 * workspace. The CRM routes (`GET /leads`, `GET /deals`) are gated to that
 * org server-side (`middleware/crm-access.ts`); for every customer org they
 * answer 403/409, which here means "not your data", so this panel renders
 * nothing at all rather than an error.
 *
 * Left: the lead funnel (new -> contacted -> qualified -> converted) from
 * the API's own whole-table `statusCounts`, drawn as flowing bands.
 * Right: deal value by open stage, plus won value and the probability-
 * weighted pipeline — summed from the real deal rows (first 100; the panel
 * says so when there are more).
 */

const OPEN_STAGES: DealStage[] = ["new", "qualifying", "proposal", "negotiation"];
const LEAD_LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", converted: "Converted", lost: "Lost" };

function notApplicable(err: Error) {
  return err instanceof ApiError && (err.status === 403 || err.status === 409 || err.status === 500);
}

export function CrmPipeline() {
  const state = useAsyncData(async () => {
    const [leads, deals] = await Promise.all([fetchLeads({ limit: 1 }), fetchDeals({ limit: 100 })]);
    return { statusCounts: leads.statusCounts, leadTotal: leads.total, deals: deals.items, dealTotal: deals.total };
  }, []);

  if (state.status === "error" && notApplicable(state.error)) return null;

  return (
    <Panel eyebrow="CRM · internal" title="Revenue pipeline" icon={<Handshake size={14} />} href="/crm/deals" hrefLabel="Deals">
      {state.status === "loading" && <PanelSkeleton height={240} />}
      {state.status === "error" && <PanelError onRetry={state.reload} height={240} />}
      {state.status === "success" &&
        (state.data.leadTotal === 0 && state.data.dealTotal === 0 ? (
          <PanelEmpty
            icon={<Handshake size={16} />}
            height={220}
            title="No leads yet"
            body="Snapshot requests and apply-form submissions land here as leads automatically."
            action={{ href: "/crm/leads", label: "Open Leads" }}
          />
        ) : (
          <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-6">
            <LeadFunnel counts={state.data.statusCounts} />
            <DealStages deals={state.data.deals} total={state.data.dealTotal} />
          </div>
        ))}
    </Panel>
  );
}

function LeadFunnel({ counts }: { counts: Record<LeadStatus, number> }) {
  const { ref, paused } = useOffscreenPause<HTMLDivElement>();
  const values = LEAD_STATUS_SEQUENCE.map((s) => counts[s] ?? 0);
  const max = Math.max(1, ...values);
  const W = 400;
  const H = 150;
  const MID = H / 2;
  const colW = W / values.length;
  const hFor = (v: number) => (v <= 0 ? 2 : Math.max(10, (Math.sqrt(v) / Math.sqrt(max)) * (H - 16)));

  return (
    <div ref={ref} data-paused={paused}>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground mb-2">Lead funnel</p>
      <div className="grid grid-cols-4 gap-1 mb-1">
        {LEAD_STATUS_SEQUENCE.map((s, i) => (
          <div key={s} className="text-center min-w-0">
            <p className="text-[20px] font-semibold text-foreground leading-tight">
              <AnimatedNumber value={values[i]!} />
            </p>
            <p className="text-[11px] text-muted-foreground truncate">{LEAD_LABEL[s]}</p>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[120px]" aria-hidden="true">
        {values.slice(0, -1).map((v, i) => {
          const a = hFor(v);
          const b = hFor(values[i + 1]!);
          const x0 = colW * i + colW / 2;
          const x1 = colW * (i + 1) + colW / 2;
          const cx = (x0 + x1) / 2;
          const d = `M${x0} ${r2(MID - a / 2)} C ${cx} ${r2(MID - a / 2)}, ${cx} ${r2(MID - b / 2)}, ${x1} ${r2(MID - b / 2)} L ${x1} ${r2(MID + b / 2)} C ${cx} ${r2(MID + b / 2)}, ${cx} ${r2(MID + a / 2)}, ${x0} ${r2(MID + a / 2)} Z`;
          return (
            <g key={i}>
              <motion.path d={d} style={{ fill: "var(--accent)" }} initial={{ opacity: 0 }} animate={{ opacity: 0.16 + i * 0.07 }} transition={{ duration: 0.7, delay: 0.2 + i * 0.12, ease: easings.decelerate }} />
              {v > 0 && values[i + 1]! > 0 && (
                <path
                  d={`M${x0} ${MID} C ${cx} ${MID}, ${cx} ${MID}, ${x1} ${MID}`}
                  pathLength={155}
                  fill="none"
                  className="ov-flow"
                  style={{ stroke: "var(--accent)", ["--ov-dur" as string]: `${4 + i}s` }}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[11.5px] text-subtle-foreground">
        {counts.lost ?? 0} lost · {values[0]! > 0 ? `${Math.round((values[3]! / values[0]!) * 100)}% new → converted (count ratio)` : "no new leads"}
      </p>
      <SrTable caption="Leads by status" head={["Status", "Leads"]} rows={[...LEAD_STATUS_SEQUENCE, "lost" as const].map((s) => [LEAD_LABEL[s], counts[s] ?? 0])} />
    </div>
  );
}

function DealStages({ deals, total }: { deals: Deal[]; total: number }) {
  // Sum one currency only — adding EUR to USD would be a fabricated number.
  const byCurrency = new Map<string, number>();
  for (const d of deals) byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + 1);
  const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const rows = deals.filter((d) => d.currency === currency);

  const valueBy = (stage: DealStage) => rows.filter((d) => d.stage === stage).reduce((a, d) => a + d.valueCents, 0);
  const countBy = (stage: DealStage) => rows.filter((d) => d.stage === stage).length;
  const open = rows.filter((d) => OPEN_STAGES.includes(d.stage));
  const openValue = open.reduce((a, d) => a + d.valueCents, 0);
  const weighted = open.reduce((a, d) => a + (d.valueCents * d.probability) / 100, 0);
  const won = valueBy("won");
  const max = Math.max(1, ...OPEN_STAGES.map(valueBy));

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground mb-2">Deals by stage</p>
      <dl className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Open", value: openValue },
          { label: "Weighted", value: weighted },
          { label: "Won", value: won },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-surface px-2.5 py-2 min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-subtle-foreground">{s.label}</dt>
            <dd className={cn("mt-0.5 text-[16px] font-semibold truncate", s.label === "Won" ? "text-success" : "text-foreground")}>
              <AnimatedNumber value={s.value} format={(v) => formatCompactCurrency(v, currency)} />
            </dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2">
        {OPEN_STAGES.map((stage, i) => (
          <li key={stage} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
            <span className="text-[12px] text-muted-foreground truncate">
              {DEAL_STAGE_LABEL[stage]} <span className="font-mono text-subtle-foreground">({countBy(stage)})</span>
            </span>
            <span className="h-2 rounded-full bg-surface overflow-hidden">
              <motion.span
                className="block h-full w-full rounded-full bg-accent origin-left"
                style={{ opacity: 0.45 + i * 0.18 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: valueBy(stage) / max }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.08, ease: easings.emphasized }}
              />
            </span>
            <span className="font-mono text-[11.5px] text-foreground text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatCompactCurrency(valueBy(stage), currency)}
            </span>
          </li>
        ))}
      </ul>
      {(total > deals.length || byCurrency.size > 1) && (
        <p className="mt-2 text-[11px] text-subtle-foreground">
          {total > deals.length ? `Summed over the ${deals.length} most recent of ${total} deals. ` : ""}
          {byCurrency.size > 1 ? `${currency} deals only.` : ""}
        </p>
      )}
      <SrTable
        caption={`Open deal value by stage (${currency})`}
        head={["Stage", "Deals", "Value"]}
        rows={[...OPEN_STAGES, "won" as const].map((s) => [DEAL_STAGE_LABEL[s], countBy(s), formatCompactCurrency(valueBy(s), currency)])}
      />
    </div>
  );
}
