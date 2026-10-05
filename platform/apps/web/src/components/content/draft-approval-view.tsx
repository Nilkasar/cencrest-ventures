"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, FileQuestion, FileText } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Textarea,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { DetailHeader } from "@/components/patterns/page-header";
import { LinkTabs } from "@/components/patterns/link-tabs";
import { SplitLayout } from "@/components/patterns/layout";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { DetailSkeleton } from "@/components/patterns/states";
import { useAsyncData } from "@/lib/use-async-data";
import { ContentDraftNotFoundError, approveDraft, getContentBrief, getContentDraft, getQualityChecks } from "@/data/content/client";
import type { ContentApproval, ContentBrief, ContentDraft, ContentQualityCheck } from "@/data/content/types";
import { DRAFT_STATUS_BADGE_VARIANT, DRAFT_STATUS_LABEL, contentTypeLabel, splitImplementationNotes } from "@/data/content/labels";
import { formatDateTime, formatNumber } from "@/lib/format";
import { QualityCheckList, QualitySummary } from "./quality-check-list";

interface DraftDetail {
  draft: ContentDraft;
  brief: ContentBrief;
  checks: ContentQualityCheck[];
  siblingDrafts: ContentDraft[];
}

async function loadDraftDetail(draftId: string): Promise<DraftDetail> {
  const { draft, brief } = await getContentDraft(draftId);
  const [checksResult, briefDetail] = await Promise.all([getQualityChecks(draftId), getContentBrief(brief.id).catch(() => null)]);
  return { draft, brief, checks: checksResult.checks, siblingDrafts: briefDetail?.drafts ?? [draft] };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">{label}</p>
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

/**
 * The draft approval screen — Epic 11: "the approval screen must show the
 * draft alongside its brief's original requirements — a reviewer approving
 * blind defeats the point of the approval gate." Brief (left) and draft
 * (right) side by side from one `GET /content-drafts/:id`, quality checks
 * below, always visible. Approve sits in the header (one click, confirmed
 * in a dialog with optional notes). Approving never publishes — there is
 * no publish control anywhere on this page (ADR-007).
 */
export function DraftApprovalView({ draftId }: { draftId: string }) {
  const router = useRouter();
  const { reload, ...state } = useAsyncData(() => loadDraftDetail(draftId), [draftId]);
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justApproved, setJustApproved] = useState<ContentApproval | null>(null);

  async function handleApprove() {
    setApproving(true);
    try {
      const result = await approveDraft(draftId, notes.trim() || undefined);
      setJustApproved(result.approval);
      setDialogOpen(false);
      toast({
        title: result.alreadyApproved ? "Already approved" : "Draft approved",
        description: result.alreadyApproved
          ? "This draft was already approved — nothing changed."
          : "It's now an action awaiting a publish approval in Actions. Nothing was published.",
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

  if (state.status === "loading") return <DetailSkeleton label="Loading draft…" />;

  if (state.status === "error") {
    if (state.error instanceof ContentDraftNotFoundError) {
      return (
        <EmptyState
          icon={<FileQuestion size={20} />}
          title="Draft not found"
          description="This draft may have been replaced by a newer version, or the link is out of date."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push("/content")}>
              Back to Content
            </Button>
          }
        />
      );
    }
    return (
      <>
        <DetailHeader backHref="/content" backLabel="Content" title="Draft" />
        <ErrorPanel title="This draft didn't load" message={state.error.message} onRetry={reload} />
      </>
    );
  }

  const { draft, brief, checks, siblingDrafts } = state.data;
  const approved = draft.status === "approved";
  const split = splitImplementationNotes(brief.implementationNotes);
  const failed = checks.filter((c) => c.status === "fail").length;
  const versions = siblingDrafts.slice().sort((a, b) => a.version - b.version);

  return (
    <>
      <DetailHeader
        backHref="/content"
        backLabel="Content"
        leading={
          <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground" aria-hidden="true">
            <FileText size={20} />
          </span>
        }
        title={draft.title ?? brief.title}
        badges={
          <>
            <Badge variant={DRAFT_STATUS_BADGE_VARIANT[draft.status]} dot>
              {DRAFT_STATUS_LABEL[draft.status]}
            </Badge>
            <Badge variant="outline">v{draft.version}</Badge>
          </>
        }
        subtitle={`From brief “${brief.title}” · ${contentTypeLabel(brief.contentType)}`}
        meta={[
          { label: "Words", value: formatNumber(draft.wordCount) },
          { label: "Quality", value: `${checks.filter((c) => c.status === "pass").length} of 5 passed` },
          { label: "Model", value: `${draft.providerName}${draft.modelName ? ` / ${draft.modelName}` : ""}` },
          { label: "Prompt", value: draft.promptVersion },
          { label: "Generated", value: formatDateTime(draft.generatedAt) },
        ]}
        actions={
          approved ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/actions">
                Go to Actions <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
              <CheckCircle2 size={14} aria-hidden="true" /> Approve draft
            </Button>
          )
        }
        tabs={
          versions.length > 1 ? (
            <LinkTabs label="Draft versions" tabs={versions.map((d) => ({ href: `/content/drafts/${d.id}`, label: `v${d.version}`, exact: true }))} />
          ) : undefined
        }
      />

      <PageStack>
        {approved && (
          <Reveal>
            <div role="status" className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success-muted px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Approved — waiting in the Action Center</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {justApproved
                      ? `Approved as ${justApproved.approvedRole} on ${formatDateTime(justApproved.approvedAt)}${justApproved.notes ? ` — “${justApproved.notes}”` : ""}. `
                      : ""}
                    A person approves the actual publish in Actions. Nothing is published automatically.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        )}

        <SplitLayout>
          <Section title="Brief requirements" description="What this draft was asked to do.">
            <div className="flex flex-col gap-4">
              {(brief.targetQuery || brief.targetIntent) && (
                <div className="flex flex-wrap items-center gap-2">
                  {brief.targetQuery && <span className="text-[13px] text-foreground">&ldquo;{brief.targetQuery}&rdquo;</span>}
                  {brief.targetIntent && (
                    <Badge variant="outline" size="sm">
                      {brief.targetIntent} intent
                    </Badge>
                  )}
                </div>
              )}
              <Field label="Evidence" value={brief.evidenceSummary} />
              {split ? (
                <>
                  <Field label="SEO requirements" value={split.seo} />
                  <Field label="GEO requirements" value={split.geo} />
                </>
              ) : (
                <Field label="Implementation notes" value={brief.implementationNotes} />
              )}
              {brief.researchNotes.brandClaims && brief.researchNotes.brandClaims.length > 0 && (
                <Field label="Brand claims referenced" value={brief.researchNotes.brandClaims.map((c) => c.claim).join("\n")} />
              )}
              {brief.keywords.length > 0 && (
                <div>
                  <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Keywords</p>
                  <div className="flex flex-wrap gap-1.5">
                    {brief.keywords.map((kw) => (
                      <Badge key={kw} variant="outline" size="sm">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section title="Generated draft" description={`${formatNumber(draft.wordCount)} words`}>
            <div className="flex flex-col gap-4">
              {draft.title && <Field label="Title" value={draft.title} />}
              {draft.metaDescription && <Field label="Meta description" value={draft.metaDescription} />}
              <div>
                <p className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">Body</p>
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Draft body"
                  className="max-h-[520px] overflow-y-auto rounded-lg border border-border bg-surface/60 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">{draft.body}</p>
                </div>
              </div>
            </div>
          </Section>
        </SplitLayout>

        <Section
          title="Quality checks"
          description={failed > 0 ? "Some checks flagged issues — read them before approving." : "Fact, brand voice, duplication, SEO and GEO."}
          actions={<QualitySummary checks={checks} className="hidden sm:flex" />}
        >
          <QualitySummary checks={checks} className="mb-1 sm:hidden" />
          <QualityCheckList checks={checks} columns={2} />
        </Section>
      </PageStack>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this draft?</DialogTitle>
            <DialogDescription>
              Approving marks v{draft.version} &ldquo;ready to publish&rdquo; and creates an action in Actions. It doesn&apos;t publish anything — that boundary is
              enforced server-side.
            </DialogDescription>
          </DialogHeader>
          {failed > 0 && (
            <p className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-[12.5px] text-foreground">
              {failed} of 5 quality checks failed on this draft.
            </p>
          )}
          <Textarea
            label="Notes (optional)"
            placeholder="Anything the person approving the publish should know…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={approving} onClick={handleApprove}>
              Approve draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
