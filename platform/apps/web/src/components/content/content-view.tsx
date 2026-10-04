"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, FileCheck2, FileText, Sparkles } from "lucide-react";
import { Button, EmptyState, RefreshOverlay, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { StatGrid, StatTile } from "@/components/patterns/stat-tile";
import { useAsyncData } from "@/lib/use-async-data";
import { getContentBrief, getQualityChecks, generateDraft, listContentBriefs } from "@/data/content/client";
import type { ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
import { formatNumber } from "@/lib/format";
import { BriefRow } from "./brief-row";
import { PendingDraftCard } from "./pending-draft-card";

interface PendingDraft {
  brief: ContentBrief;
  draft: ContentDraft;
  checks: ContentQualityCheck[];
}

interface ContentOverview {
  briefs: ContentBrief[];
  total: number;
  draftsByBrief: Map<string, ContentDraft[]>;
  pendingDrafts: PendingDraft[];
}

type TabKey = "pending" | "briefs" | "published";

/** `GET /brands/me/content-briefs` returns briefs only — draft history
 *  comes from the per-brief `GET /content-briefs/:id`, and there is no
 *  bulk "all drafts" endpoint, so this joins client-side (a documented
 *  N+1 over a small list), then fetches quality checks for the drafts
 *  awaiting approval. */
async function loadContentOverview(): Promise<ContentOverview> {
  const page = await listContentBriefs({ limit: 100 });
  const briefsWithDrafts = await Promise.all(
    page.briefs.map(async (brief) => ({
      brief,
      drafts: await getContentBrief(brief.id)
        .then((d) => d.drafts)
        .catch(() => [] as ContentDraft[]),
    })),
  );

  const draftsByBrief = new Map<string, ContentDraft[]>();
  const pendingPairs: Array<{ brief: ContentBrief; draft: ContentDraft }> = [];
  for (const { brief, drafts } of briefsWithDrafts) {
    draftsByBrief.set(brief.id, drafts);
    for (const draft of drafts) {
      if (draft.status === "generated") pendingPairs.push({ brief, draft });
    }
  }

  const pendingDrafts: PendingDraft[] = await Promise.all(
    pendingPairs.map(async (pair) => ({
      ...pair,
      checks: await getQualityChecks(pair.draft.id)
        .then((r) => r.checks)
        .catch(() => [] as ContentQualityCheck[]),
    })),
  );
  // Newest-generated first — a reviewer's queue reads top-down.
  pendingDrafts.sort((a, b) => new Date(b.draft.generatedAt).getTime() - new Date(a.draft.generatedAt).getTime());

  return { briefs: page.briefs, total: page.pagination.total, draftsByBrief, pendingDrafts };
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading content…</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-[420px]" />
      <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised shadow-sm" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2.5 px-5 py-4">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Epic 11 (Content Intelligence & Generation)'s Content screen. The main
 * job is the review queue — drafts awaiting approval, quality checks
 * visible — so it opens there whenever anything is waiting. Briefs are
 * generated from a content-type recommendation (Recommendations →
 * "Generate content brief"); drafts are generated here; publishing is
 * Epic 13's Action Center.
 */
export function ContentView() {
  const { reload, ...state } = useAsyncData(loadContentOverview, []);
  const { toast } = useToast();
  const [generatingBriefId, setGeneratingBriefId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey | null>(null);

  async function handleGenerateDraft(brief: ContentBrief) {
    setGeneratingBriefId(brief.id);
    try {
      const { draft, qualityChecks } = await generateDraft(brief.id);
      const failed = qualityChecks.filter((c) => c.status === "fail").length;
      toast({
        title: `Draft v${draft.version} generated`,
        description: failed > 0 ? `${failed} of 5 quality checks flagged an issue — review before approving.` : "All 5 quality checks passed. It's in the review queue.",
        variant: failed > 0 ? "warning" : undefined,
      });
      reload();
    } catch (err) {
      toast({
        title: "Couldn't generate a draft",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setGeneratingBriefId(null);
    }
  }

  const data = state.status === "success" ? state.data : null;
  const firstRun = data !== null && data.briefs.length === 0;
  const allDrafts = data ? [...data.draftsByBrief.values()].flat() : [];
  const approvedDrafts = allDrafts.filter((d) => d.status === "approved").length;
  const activeTab: TabKey = tab ?? (data && data.pendingDrafts.length > 0 ? "pending" : "briefs");

  return (
    <PageStack>
      {state.status === "loading" && (
        <Reveal>
          <ListSkeleton />
        </Reveal>
      )}

      {state.status === "error" && (
        <Reveal>
          <ErrorPanel title="Content didn't load" message={state.error.message} onRetry={reload} />
        </Reveal>
      )}

      {firstRun && (
        <Reveal>
          <EmptyState
            icon={<FileText size={20} />}
            title="No content briefs yet"
            description="A brief is generated from a Create-a-page or Update-a-page recommendation once it's in progress. Open one and choose “Generate content brief” — drafts start here."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/recommendations">Go to Recommendations</Link>
              </Button>
            }
          />
        </Reveal>
      )}

      {data && !firstRun && (
        <>
          <StatGrid>
            <StatTile
              label="Awaiting review"
              icon={<ClipboardList size={13} />}
              value={formatNumber(data.pendingDrafts.length)}
              hint={data.pendingDrafts.length > 0 ? "Drafts ready for your approval" : "Queue is clear"}
            />
            <StatTile
              label="Briefs"
              icon={<FileText size={13} />}
              value={formatNumber(data.total)}
              hint={data.total > data.briefs.length ? `Showing the latest ${formatNumber(data.briefs.length)}` : "From your recommendations"}
            />
            <StatTile label="Drafts generated" icon={<Sparkles size={13} />} value={formatNumber(allDrafts.length)} hint="All versions, across briefs" />
            <StatTile label="Approved" icon={<FileCheck2 size={13} />} value={formatNumber(approvedDrafts)} hint="Handed to Actions to publish" href="/actions" />
          </StatGrid>

          <Reveal>
            <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList variant="underline" aria-label="Content">
                <TabsTrigger value="pending">
                  Awaiting review <Count n={data.pendingDrafts.length} />
                </TabsTrigger>
                <TabsTrigger value="briefs">
                  Briefs <Count n={data.briefs.length} />
                </TabsTrigger>
                <TabsTrigger value="published">Published</TabsTrigger>
              </TabsList>

              <RefreshOverlay active={state.isRefreshing} className="mt-5">
                <TabsContent value="pending" className="mt-0">
                  {data.pendingDrafts.length === 0 ? (
                    <EmptyState
                      compact
                      icon={<CheckCircle2 size={18} />}
                      title="Nothing to review"
                      description="Every generated draft lands here with its five quality checks until it's approved. Generate one from a brief."
                      action={
                        <Button variant="secondary" size="sm" onClick={() => setTab("briefs")}>
                          View briefs
                        </Button>
                      }
                    />
                  ) : (
                    <Section flush title="Review queue" description="Newest first. Open a draft to see it beside its brief, then approve.">
                      <ul className="divide-y divide-border">
                        {data.pendingDrafts.map(({ brief, draft, checks }) => (
                          <li key={draft.id}>
                            <PendingDraftCard brief={brief} draft={draft} checks={checks} />
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </TabsContent>

                <TabsContent value="briefs" className="mt-0">
                  <Section flush title="Briefs" description="Each carries its recommendation's SEO and GEO requirements forward, word for word.">
                    <ul className="divide-y divide-border">
                      {data.briefs.map((brief) => (
                        <li key={brief.id}>
                          <BriefRow
                            brief={brief}
                            drafts={data.draftsByBrief.get(brief.id)}
                            generating={generatingBriefId === brief.id}
                            onGenerateDraft={handleGenerateDraft}
                          />
                        </li>
                      ))}
                    </ul>
                  </Section>
                </TabsContent>

                <TabsContent value="published" className="mt-0">
                  <EmptyState
                    compact
                    icon={<CheckCircle2 size={18} />}
                    title="Published content lives in Actions"
                    description="Approving a draft creates an action. A person approves and executes the actual publish there — and sees what changed afterwards."
                    action={
                      <Button asChild variant="secondary" size="sm">
                        <Link href="/actions">Go to Actions</Link>
                      </Button>
                    }
                  />
                </TabsContent>
              </RefreshOverlay>
            </Tabs>
          </Reveal>
        </>
      )}
    </PageStack>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-full bg-surface px-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">{n}</span>;
}
