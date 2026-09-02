"use client";

import { useState } from "react";
import { FolderPlus, Sparkles, Tags } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Skeleton, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { useAsyncData } from "@/lib/use-async-data";
import { NoKeywordCandidatesError, createKeywordGroup, generateKeywordGroup, listKeywordGroups } from "@/data/seo/client";
import { KeywordGroupCard } from "./keyword-group-card";
import { KeywordGroupDialog } from "./keyword-group-dialog";

function GroupsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Keyword coverage — a list of `keyword_groups`, each expandable to its
 *  `seo_keywords`. "Generate from brand profile" is the primary path (real
 *  `categories`/`use_cases`, never a fixture); manual groups/keywords cover
 *  the CRUD half of the epic's API surface. Generating also creates one
 *  scored opportunity per keyword server-side, so `onGenerated` tells the
 *  parent view to refresh the Opportunities panel too. */
export function KeywordCoveragePanel({ onGenerated }: { onGenerated: () => void }) {
  const { reload, ...state } = useAsyncData(listKeywordGroups, []);
  const status = state.status;
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

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
        <FolderPlus size={13} /> New group
      </Button>
      <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
        <Sparkles size={13} /> Generate from brand profile
      </Button>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-[16px] font-semibold text-foreground">Keyword coverage</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              Topic clusters and the phrases inside them — seeded from your brand profile or curated by hand.
            </p>
          </div>
          {status === "success" && groups.length > 0 && actions}
        </div>

        {generateError && <ErrorPanel compact message={generateError} onRetry={handleGenerate} />}

        {status === "loading" && <GroupsSkeleton />}

        {state.status === "error" && <ErrorPanel message={state.error.message} onRetry={reload} />}

        {status === "success" && groups.length === 0 && (
          <EmptyState
            icon={<Tags size={20} />}
            title="No keyword groups yet"
            description="Generate an initial list from your brand's categories and use cases, or start a group manually."
            action={
              <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
                <Sparkles size={13} /> Generate from brand profile
              </Button>
            }
            secondaryAction={
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                <FolderPlus size={13} /> New group
              </Button>
            }
          />
        )}

        {status === "success" && groups.length > 0 && (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <KeywordGroupCard
                key={group.id}
                group={group}
                defaultOpen={group.id === justCreatedId}
                onRenamed={reload}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </CardContent>

      <KeywordGroupDialog
        key={createOpen ? "create-open" : "create-closed"}
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreate}
        submitting={createSubmitting}
      />
    </Card>
  );
}
