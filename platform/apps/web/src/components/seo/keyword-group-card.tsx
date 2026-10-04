"use client";

import { useId, useState } from "react";
import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { typography } from "@/components/patterns/typography";
import { useAsyncData } from "@/lib/use-async-data";
import {
  addKeyword,
  deleteKeywordGroup,
  listKeywords,
  removeKeyword,
  renameKeywordGroup,
  updateKeyword,
  type NewKeywordInput,
} from "@/data/seo/client";
import type { KeywordGroup, SeoKeyword } from "@/data/seo/types";
import { PROVIDER_SOURCE_LABEL } from "@/data/seo/labels";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { KeywordGroupDialog } from "./keyword-group-dialog";
import { KeywordFormDialog } from "./keyword-form-dialog";
import { KeywordConfidenceBadge, KeywordIntentBadge, Meter } from "./status-badges";

interface KeywordGroupCardProps {
  group: KeywordGroup;
  defaultOpen?: boolean;
  onRenamed: () => void;
  onDeleted: (groupId: string) => void;
}

/** One keyword group as a row of the Keyword coverage list (an `<li>`):
 *  a disclosure header with its count and actions, expanding to the
 *  group's keyword table. */
export function KeywordGroupCard({ group, defaultOpen = false, onRenamed, onDeleted }: KeywordGroupCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { reload, ...keywordsState } = useAsyncData(() => listKeywords(group.id), [group.id]);
  const status = keywordsState.status;
  const keywords = keywordsState.status === "success" ? keywordsState.data : [];
  const { toast } = useToast();

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [keywordDialog, setKeywordDialog] = useState<{ mode: "create" } | { mode: "edit"; keyword: SeoKeyword } | null>(null);
  const [keywordSubmitting, setKeywordSubmitting] = useState(false);
  const [keywordError, setKeywordError] = useState<string | undefined>(undefined);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const count = status === "success" ? keywords.length : (group.keywordCount ?? 0);

  async function handleRename(name: string) {
    setRenameSubmitting(true);
    try {
      await renameKeywordGroup(group.id, name);
      setRenameOpen(false);
      onRenamed();
    } catch {
      toast({ title: "Couldn't rename that group", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setRenameSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${group.name}"? Its keywords will no longer be shown here.`)) return;
    setDeleting(true);
    try {
      await deleteKeywordGroup(group.id);
      onDeleted(group.id);
    } catch {
      toast({ title: "Couldn't delete that group", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleKeywordSubmit(values: NewKeywordInput) {
    setKeywordSubmitting(true);
    setKeywordError(undefined);
    try {
      if (keywordDialog?.mode === "edit") {
        await updateKeyword(group.id, keywordDialog.keyword.id, values);
      } else {
        await addKeyword(group.id, values);
      }
      setKeywordDialog(null);
      setOpen(true);
      reload();
    } catch (err) {
      setKeywordError(err instanceof Error ? err.message : "Couldn't save that keyword — try again.");
    } finally {
      setKeywordSubmitting(false);
    }
  }

  async function handleRemoveKeyword(keyword: SeoKeyword) {
    setRemovingId(keyword.id);
    try {
      await removeKeyword(group.id, keyword.id);
      reload();
    } catch {
      toast({ title: "Couldn't remove that keyword", description: "Try again in a moment.", variant: "danger" });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <li>
      <div className="flex min-h-[56px] items-center gap-2 px-5 py-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="-ml-2 flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={panelId}
        >
          <ChevronRight
            size={14}
            className={cn("shrink-0 text-subtle-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
            aria-hidden="true"
          />
          <span className="truncate text-[13.5px] font-medium text-foreground">{group.name}</span>
          <span className="shrink-0 rounded-full bg-surface px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {count}
            <span className="sr-only"> keyword{count === 1 ? "" : "s"}</span>
          </span>
        </button>
        <span className={cn(typography.meta, "hidden shrink-0 md:inline")}>Updated {formatRelativeTime(group.updatedAt)}</span>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setKeywordDialog({ mode: "create" })}>
          <Plus size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Add keyword</span>
          <span className="sr-only sm:hidden">Add a keyword to {group.name}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`More actions for "${group.name}"`} disabled={deleting}>
              <MoreHorizontal size={15} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil size={13} aria-hidden="true" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={handleDelete}>
              <Trash2 size={13} aria-hidden="true" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <div id={panelId} className="border-t border-border bg-surface/40">
          {status === "loading" && (
            <div className="flex flex-col gap-2 p-4" aria-busy="true">
              <span className="sr-only">Loading keywords…</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {keywordsState.status === "error" && (
            <div className="p-4">
              <ErrorPanel compact title="Keywords didn't load" message={keywordsState.error.message} onRetry={reload} />
            </div>
          )}

          {status === "success" && keywords.length === 0 && (
            <EmptyState
              compact
              title="No keywords in this group yet"
              description="Add the phrases this cluster should rank for. Each one is scored for demand and coverage."
              action={
                <Button variant="outline" size="sm" onClick={() => setKeywordDialog({ mode: "create" })}>
                  <Plus size={13} aria-hidden="true" /> Add keyword
                </Button>
              }
            />
          )}

          {status === "success" && keywords.length > 0 && (
            <Table framed={false}>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-12">Keyword</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Volume / mo</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.map((keyword) => (
                  <TableRow key={keyword.id}>
                    <TableCell className="max-w-[280px] pl-12">
                      <span className="block truncate text-[13px] text-foreground">{keyword.text}</span>
                    </TableCell>
                    <TableCell>
                      {keyword.intent ? <KeywordIntentBadge intent={keyword.intent} /> : <span className="text-subtle-foreground">&mdash;</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={typography.numeric}>{keyword.monthlyVolume !== null ? formatNumber(keyword.monthlyVolume) : "—"}</span>
                    </TableCell>
                    <TableCell>
                      {keyword.difficulty !== null ? (
                        <span className="flex items-center gap-2">
                          <Meter value={keyword.difficulty} className="w-12" fillClassName="bg-muted-foreground" />
                          <span className={typography.numeric}>{keyword.difficulty}</span>
                        </span>
                      ) : (
                        <span className="text-subtle-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <KeywordConfidenceBadge confidence={keyword.confidence} />
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-[12px] text-muted-foreground">{PROVIDER_SOURCE_LABEL[keyword.source]}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-subtle-foreground hover:text-foreground"
                          aria-label={`Edit "${keyword.text}"`}
                          onClick={() => setKeywordDialog({ mode: "edit", keyword })}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-subtle-foreground hover:text-danger"
                          aria-label={`Remove "${keyword.text}"`}
                          loading={removingId === keyword.id}
                          onClick={() => handleRemoveKeyword(keyword)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <KeywordGroupDialog
        key={renameOpen ? "rename-open" : "rename-closed"}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        mode="rename"
        initialName={group.name}
        onSubmit={handleRename}
        submitting={renameSubmitting}
      />

      {keywordDialog && (
        <KeywordFormDialog
          key={keywordDialog.mode === "edit" ? keywordDialog.keyword.id : "create"}
          open
          onOpenChange={(next) => !next && setKeywordDialog(null)}
          mode={keywordDialog.mode}
          initial={keywordDialog.mode === "edit" ? keywordDialog.keyword : undefined}
          onSubmit={handleKeywordSubmit}
          submitError={keywordError}
          submitting={keywordSubmitting}
        />
      )}
    </li>
  );
}
