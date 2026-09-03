"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Sparkles } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@bebest/ui";
import { PageHeader } from "@/components/patterns/page-header";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { getContentBrief, getQualityChecks, generateDraft, listContentBriefs } from "@/data/content/client";
import type { ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
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

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** `GET /brands/me/content-briefs` returns briefs only — the draft version
 *  history (and hence which drafts are actually `"generated"`/awaiting
 *  approval) only comes back from the per-brief `GET /content-briefs/:id`.
 *  There is no bulk "all drafts across every brief" endpoint, so this joins
 *  client-side: fetch every brief's own detail, then fetch quality checks
 *  for whichever drafts turn out to be pending — the same "join real
 *  endpoints client-side, document the extra round trips" precedent
 *  `opportunities-view.tsx`'s header comment already sets for Epic 9+10.
 *  Brief counts here are small in practice (one per approved content-type
 *  recommendation), so the N+1 shape is a documented tradeoff, not a
 *  performance risk. */
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
  // Newest-generated first — a reviewer's queue reads top-down, most recent
  // work first.
  pendingDrafts.sort((a, b) => new Date(b.draft.generatedAt).getTime() - new Date(a.draft.generatedAt).getTime());

  return { briefs: page.briefs, total: page.pagination.total, draftsByBrief, pendingDrafts };
}

/**
 * Epic 11 (Content Intelligence & Generation)'s "Content" screen —
 * `docs/09-ux/CUSTOMER_JOURNEY.md`'s Content screen, per the epic's UI
 * surface requirement: active briefs, drafts awaiting approval (quality
 * checks visible, not hidden behind a click), published content. Calls
 * `platform/apps/api`'s real, tested routes from the first line, no
 * fixture layer.
 *
 * A content-type recommendation's brief is generated from the
 * Recommendations screen (`next-action-panel.tsx`'s "Generate content
 * brief" — pipeline step 1); this screen picks up from there: generating
 * drafts from a brief, and reviewing/approving them. Published content is
 * always empty in this epic — Epic 13 is what actually publishes an
 * approved draft.
 */
export function ContentView() {
  const { reload, ...state } = useAsyncData(loadContentOverview, []);
  const { toast } = useToast();
  const [generatingBriefId, setGeneratingBriefId] = useState<string | null>(null);

  async function handleGenerateDraft(brief: ContentBrief) {
    setGeneratingBriefId(brief.id);
    try {
      const { draft, qualityChecks } = await generateDraft(brief.id);
      const failed = qualityChecks.filter((c) => c.status === "fail").length;
      toast({
        title: `Draft v${draft.version} generated`,
        description: failed > 0 ? `${failed} of 5 quality checks flagged an issue — review before approving.` : "All 5 quality checks passed.",
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

  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Content"
        description="Active content briefs, drafts awaiting approval, and published content. Every draft is generated from an approved recommendation's evidence, checked against fact, brand-voice, duplicate-content, SEO, and GEO signals, and never published without your explicit approval."
      />

      {state.status === "loading" && (
        <Card>
          <ListSkeleton />
        </Card>
      )}

      {state.status === "error" && (
        <Card>
          <CardContent className="p-5">
            <ErrorPanel message={state.error.message} onRetry={reload} />
          </CardContent>
        </Card>
      )}

      {state.status === "success" && (
        <Tabs defaultValue="briefs">
          <TabsList>
            <TabsTrigger value="briefs">Active briefs ({state.data.briefs.length})</TabsTrigger>
            <TabsTrigger value="pending">Awaiting approval ({state.data.pendingDrafts.length})</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
          </TabsList>

          <TabsContent value="briefs">
            <Card>
              <CardContent className="p-0">
                {state.data.briefs.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      compact
                      icon={<FileText size={18} />}
                      title="No content briefs yet"
                      description="Generate a brief from an approved, content-type recommendation (Create a page / Update a page, moved to In progress or Completed) on the Recommendations screen."
                      action={
                        <Button asChild variant="secondary" size="sm">
                          <Link href="/recommendations">Go to Recommendations</Link>
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {state.data.briefs.map((brief) => (
                      <BriefRow
                        key={brief.id}
                        brief={brief}
                        drafts={state.data.draftsByBrief.get(brief.id)}
                        generating={generatingBriefId === brief.id}
                        onGenerateDraft={handleGenerateDraft}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
            <Card>
              <CardContent className="p-0">
                {state.data.pendingDrafts.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      compact
                      icon={<Sparkles size={18} />}
                      title="No drafts awaiting approval"
                      description="Generate a draft from an active brief above — every draft lands here, with its quality checks, until it's approved."
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {state.data.pendingDrafts.map(({ brief, draft, checks }) => (
                      <PendingDraftCard key={draft.id} brief={brief} draft={draft} checks={checks} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="published">
            <Card>
              <CardContent className="p-5">
                <EmptyState
                  compact
                  icon={<CheckCircle2 size={18} />}
                  title="Nothing published yet"
                  description="Approved drafts are ready to publish, but this product never publishes anything automatically (ADR-007). Epic 13 owns actual publishing — approved content will appear here once it does."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
