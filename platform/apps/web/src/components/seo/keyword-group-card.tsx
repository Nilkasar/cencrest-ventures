"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
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
  useToast,
} from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
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
import {
  KEYWORD_CONFIDENCE_BADGE_VARIANT,
  KEYWORD_CONFIDENCE_LABEL,
  KEYWORD_INTENT_BADGE_VARIANT,
  KEYWORD_INTENT_LABEL,
  PROVIDER_SOURCE_LABEL,
} from "@/data/seo/labels";
import { formatDate } from "@/lib/format";
import { KeywordGroupDialog } from "./keyword-group-dialog";
import { KeywordFormDialog } from "./keyword-form-dialog";

interface KeywordGroupCardProps {
  group: KeywordGroup;
  defaultOpen?: boolean;
  onRenamed: () => void;
  onDeleted: (groupId: string) => void;
}

export function KeywordGroupCard({ group, defaultOpen = false, onRenamed, onDeleted }: KeywordGroupCardProps) {
  const [open, setOpen] = useState(defaultOpen);
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
    <div className="rounded-xl border border-border bg-surface-raised overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} className="text-subtle-foreground shrink-0" /> : <ChevronRight size={14} className="text-subtle-foreground shrink-0" />}
          <h3 className="font-display text-[14.5px] font-semibold text-foreground truncate">{group.name}</h3>
          <Badge variant="neutral" size="sm" className="shrink-0">
            {count}
          </Badge>
        </button>
        <span className="font-mono text-[11px] text-subtle-foreground shrink-0 hidden sm:inline">
          Updated {formatDate(group.updatedAt)}
        </span>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setKeywordDialog({ mode: "create" })}>
          <Plus size={13} /> Add keyword
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`More actions for "${group.name}"`} disabled={deleting}>
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil size={13} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={handleDelete}>
              <Trash2 size={13} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <div className="p-4">
          {status === "loading" && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {keywordsState.status === "error" && <ErrorPanel compact message={keywordsState.error.message} onRetry={reload} />}

          {status === "success" && keywords.length === 0 && (
            <EmptyState
              compact
              title="No keywords in this group yet"
              description="Add one manually, or generate a group from your brand profile above."
              action={
                <Button variant="outline" size="sm" onClick={() => setKeywordDialog({ mode: "create" })}>
                  <Plus size={13} /> Add keyword
                </Button>
              }
            />
          )}

          {status === "success" && keywords.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.map((keyword) => (
                  <TableRow key={keyword.id}>
                    <TableCell className="max-w-[280px] truncate">{keyword.text}</TableCell>
                    <TableCell>
                      {keyword.intent ? (
                        <Badge variant={KEYWORD_INTENT_BADGE_VARIANT[keyword.intent]} size="sm">
                          {KEYWORD_INTENT_LABEL[keyword.intent]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {keyword.monthlyVolume !== null ? keyword.monthlyVolume.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{keyword.difficulty ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={KEYWORD_CONFIDENCE_BADGE_VARIANT[keyword.confidence]} size="sm">
                        {KEYWORD_CONFIDENCE_LABEL[keyword.confidence]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{PROVIDER_SOURCE_LABEL[keyword.source]}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-subtle-foreground hover:text-foreground"
                          aria-label={`Edit "${keyword.text}"`}
                          onClick={() => setKeywordDialog({ mode: "edit", keyword })}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-subtle-foreground hover:text-danger"
                          aria-label={`Remove "${keyword.text}"`}
                          loading={removingId === keyword.id}
                          onClick={() => handleRemoveKeyword(keyword)}
                        >
                          <Trash2 size={13} />
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
    </div>
  );
}
