"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, SkeletonText, Textarea, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { approveDraft, getContentBrief, getContentDraft, getQualityChecks } from "@/data/content/client";
import type { ContentApproval, ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
import { BRIEF_STATUS_BADGE_VARIANT, BRIEF_STATUS_LABEL, DRAFT_STATUS_BADGE_VARIANT, DRAFT_STATUS_LABEL, contentTypeLabel, splitImplementationNotes } from "@/data/content/labels";
import { formatDateTime } from "@/lib/format";
import { QualityCheckList } from "./quality-check-list";

interface DraftDetail {
  draft: ContentDraft;
  brief: ContentBrief;
  checks: ContentQualityCheck[];
  siblingDrafts: ContentDraft[];
}

async function loadDraftDetail(draftId: string): Promise<DraftDetail> {
  const { draft, brief } = await getContentDraft(draftId);
  const [checksResult, briefDetail] = await Promise.all([
    getQualityChecks(draftId),
    getContentBrief(brief.id).catch(() => null),
  ]);
  return { draft, brief, checks: checksResult.checks, siblingDrafts: briefDetail?.drafts ?? [draft] };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">{label}</p>
      <p className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-line">{value}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-64" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}

/**
 * `docs/epics/11-content-intelligence-generation.md`'s UI surface, literal
 * requirement: "the approval screen must show the draft alongside its
 * brief's original requirements — a reviewer approving blind, without the
 * brief in view, defeats the point of the approval gate." Brief
 * requirements (left) and the generated draft (right) render as one
 * side-by-side view fed by a single `GET /content-drafts/:id` call
 * (`{ draft, brief }` inlined together server-side for exactly this
 * screen) — never two separately-loaded panels a reviewer has to
 * reconcile from memory. Quality checks render below, always visible, same
 * as the list screen. Approval is the only mutation here; ADR-007 means
 * there is no "publish" action anywhere on this page, or anywhere in this
 * epic's frontend.
 */
export function DraftApprovalView({ draftId }: { draftId: string }) {
  const { reload, ...state } = useAsyncData(() => loadDraftDetail(draftId), [draftId]);
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [justApproved, setJustApproved] = useState<ContentApproval | null>(null);

  async function handleApprove() {
    setApproving(true);
    try {
      const result = await approveDraft(draftId, notes.trim() || undefined);
      setJustApproved(result.approval);
      toast({
        title: result.alreadyApproved ? "Already approved" : "Draft approved",
        description: result.alreadyApproved
          ? "This draft was already approved — nothing changed."
          : "Ready to publish. Publishing itself happens in a later epic — nothing was published automatically.",
      });
      reload();
    } catch (err) {
      toast({
        title: "Couldn't approve this draft",
        description: err instanceof Error ? err.message : "Something went wrong — try again.",
        variant: "danger",
      });
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/content" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft size={14} /> Content
      </Link>

      {state.status === "loading" && <DetailSkeleton />}

      {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

      {state.status === "success" && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-[22px] font-semibold text-foreground tracking-[-0.01em]">
                  {state.data.draft.title ?? state.data.brief.title}
                </h1>
                <Badge variant="outline" size="sm">
                  v{state.data.draft.version}
                </Badge>
                <Badge variant={DRAFT_STATUS_BADGE_VARIANT[state.data.draft.status]} size="sm">
                  {DRAFT_STATUS_LABEL[state.data.draft.status]}
                </Badge>
              </div>
              <p className="text-[13px] text-muted-foreground mt-1">
                From brief “{state.data.brief.title}” · {contentTypeLabel(state.data.brief.contentType)}
              </p>
            </div>
            {state.data.siblingDrafts.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {state.data.siblingDrafts
                  .slice()
                  .sort((a, b) => a.version - b.version)
                  .map((d) => (
                    <Link
                      key={d.id}
                      href={`/content/drafts/${d.id}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 h-6 text-[11.5px] transition-colors ${
                        d.id === draftId ? "border-accent bg-accent-muted text-accent" : "border-border-strong text-foreground hover:bg-surface"
                      }`}
                    >
                      v{d.version}
                    </Link>
                  ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Brief requirements</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={BRIEF_STATUS_BADGE_VARIANT[state.data.brief.status]} size="sm">
                    Brief: {BRIEF_STATUS_LABEL[state.data.brief.status]}
                  </Badge>
                  {state.data.brief.targetIntent && (
                    <Badge variant="neutral" size="sm">
                      {state.data.brief.targetIntent} intent
                    </Badge>
                  )}
                </div>
                {state.data.brief.targetQuery && <Field label="Target query" value={state.data.brief.targetQuery} />}
                <Field label="Evidence" value={state.data.brief.evidenceSummary} />
                {(() => {
                  const split = splitImplementationNotes(state.data.brief.implementationNotes);
                  return split ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="SEO requirements" value={split.seo} />
                      <Field label="GEO requirements" value={split.geo} />
                    </div>
                  ) : (
                    <Field label="Implementation notes" value={state.data.brief.implementationNotes} />
                  );
                })()}
                {state.data.brief.researchNotes.brandClaims && state.data.brief.researchNotes.brandClaims.length > 0 && (
                  <Field
                    label="Brand claims referenced"
                    value={state.data.brief.researchNotes.brandClaims.map((c) => c.claim).join("\n")}
                  />
                )}
                {state.data.brief.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {state.data.brief.keywords.map((kw) => (
                      <Badge key={kw} variant="neutral" size="sm">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Generated draft</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-subtle-foreground">
                  <span>{state.data.draft.providerName}</span>
                  {state.data.draft.modelName && <span>/ {state.data.draft.modelName}</span>}
                  <span>· prompt {state.data.draft.promptVersion}</span>
                  <span>· {state.data.draft.wordCount} words</span>
                </div>
                {state.data.draft.title && <Field label="Title" value={state.data.draft.title} />}
                {state.data.draft.metaDescription && <Field label="Meta description" value={state.data.draft.metaDescription} />}
                <div>
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-subtle-foreground mb-1">Body</p>
                  <div className="rounded-lg border border-border bg-surface p-3 max-h-96 overflow-y-auto">
                    <p className="text-[12.5px] text-foreground whitespace-pre-wrap leading-relaxed">{state.data.draft.body}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quality checks</CardTitle>
            </CardHeader>
            <CardContent>
              <QualityCheckList checks={state.data.checks} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval</CardTitle>
            </CardHeader>
            <CardContent>
              {state.data.draft.status === "approved" ? (
                <EmptyState
                  compact
                  icon={<CheckCircle2 size={18} />}
                  title="Approved — ready to publish"
                  description={
                    justApproved
                      ? `Approved as ${justApproved.approvedRole} at ${formatDateTime(justApproved.approvedAt)}${justApproved.notes ? ` — “${justApproved.notes}”` : ""}. Nothing is published automatically.`
                      : "This draft has been approved. Nothing is published automatically — publishing is a future epic's concern."
                  }
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <Textarea
                    label="Notes (optional)"
                    placeholder="Anything the next reviewer or Epic 13's publishing step should know…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                  <div>
                    <Button variant="primary" size="sm" loading={approving} onClick={handleApprove}>
                      Approve draft
                    </Button>
                  </div>
                  <p className="text-[11.5px] text-subtle-foreground">
                    Approving marks this draft &ldquo;ready to publish.&rdquo; It does not publish anything — that boundary is enforced
                    server-side, not by convention.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
