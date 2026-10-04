"use client";

import { useState } from "react";
import { FolderPlus, Sparkles, Tags } from "lucide-react";
import { Button, EmptyState, RefreshOverlay, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { Section } from "@/components/patterns/section";
import { useAsyncData } from "@/lib/use-async-data";
import { NoKeywordCandidatesError, createKeywordGroup, generateKeywordGroup, listKeywordGroups } from "@/data/seo/client";
import { formatNumber } from "@/lib/format";
import { KeywordGroupCard } from "./keyword-group-card";
import { KeywordGroupDialog } from "./keyword-group-dialog";

/** Keyword coverage — `keyword_groups`, each expandable to its
 *  `seo_keywords`. "Generate from brand profile" is the primary path (real
 *  `categories`/`use_cases`, never a fixture); manual groups/keywords cover
 *  the CRUD half. Generating also creates one scored opportunity per
 *  keyword server-side, so `onGenerated` refreshes the Opportunities
 *  section too. */
export function KeywordCoveragePanel({ onGenerated }: { onGenerated: () => void }) {
  const { reload, ...state } = useAsyncData(listKeywordGroups, []);
  const groups = state.status === "success" ? state.data : [];
  const { toast } = useToast();

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(undefined);
    try {
      const result = await generateKeywordGroup();
      toast({
        title: "Keywords generated",
        description: `${result.keywords.length} keyword${result.keywords.length === 1 ? "" : "s"} and ${result.opportunities.length} opportunit${result.opportunities.length === 1 ? "y" : "ies"} added.`,
        variant: "success",
      });
      setJustCreatedId(result.keywordGroup.id);
      reload();
      onGenerated();
    } catch (err) {
      setGenerateError(
        err instanceof NoKeywordCandidatesError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't generate keywords — try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreate(name: string) {
    setCreateSubmitting(true);
    try {
      const group = await createKeywordGroup(name);
      setCreateOpen(false);
      setJustCreatedId(group.id);
      reload();
    } catch {
      toast({ title: "Couldn't create that group", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setCreateSubmitting(false);
    }
  }

  function handleDeleted(groupId: string) {
    toast({ title: "Group deleted", variant: "default" });
    if (justCreatedId === groupId) setJustCreatedId(null);
    reload();
  }

  const hasGroups = state.status === "success" && groups.length > 0;
  const keywordTotal = groups.reduce((sum, g) => sum + (g.keywordCount ?? 0), 0);
  const knowsKeywordTotal = groups.every((g) => g.keywordCount !== undefined);

  return (
    <Section
      title="Keyword coverage"
      description={
        hasGroups
          ? `${formatNumber(groups.length)} topic cluster${groups.length === 1 ? "" : "s"}${knowsKeywordTotal ? ` · ${formatNumber(keywordTotal)} keywords` : ""} — seeded from your brand profile or curated by hand.`
          : "Topic clusters and the phrases inside them — seeded from your brand profile or curated by hand."
      }
      actions={
        hasGroups ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus size={13} aria-hidden="true" /> <span className="hidden sm:inline">New group</span>
              <span className="sr-only sm:hidden">New group</span>
            </Button>
            <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
              <Sparkles size={13} aria-hidden="true" /> <span className="hidden sm:inline">Generate from brand profile</span>
              <span className="sm:hidden">Generate</span>
            </Button>
          </>
        ) : undefined
      }
      flush={hasGroups}
    >
      {generateError && (
        <div className={hasGroups ? "border-b border-border p-4" : "mb-4"}>
          <ErrorPanel compact title="Keywords weren't generated" message={generateError} onRetry={handleGenerate} />
        </div>
      )}

      {state.status === "loading" && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">Loading keyword groups…</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {state.status === "error" && <ErrorPanel compact title="Keyword groups didn't load" message={state.error.message} onRetry={reload} />}

      {state.status === "success" && groups.length === 0 && (
        <EmptyState
          compact
          icon={<Tags size={18} />}
          title="No keyword groups yet"
          description="Keywords are what we score your coverage and opportunities against. Generate a starting set from your brand's categories and use cases, or start a group by hand."
          action={
            <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
              <Sparkles size={13} aria-hidden="true" /> Generate from brand profile
            </Button>
          }
          secondaryAction={
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus size={13} aria-hidden="true" /> New group
            </Button>
          }
        />
      )}

      {hasGroups && (
        <RefreshOverlay active={state.isRefreshing}>
          <ul className="divide-y divide-border">
            {groups.map((group) => (
              <KeywordGroupCard key={group.id} group={group} defaultOpen={group.id === justCreatedId} onRenamed={reload} onDeleted={handleDeleted} />
            ))}
          </ul>
        </RefreshOverlay>
      )}

      <KeywordGroupDialog
        key={createOpen ? "create-open" : "create-closed"}
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreate}
        submitting={createSubmitting}
      />
    </Section>
  );
}
