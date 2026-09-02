"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bebest/ui";
import type { NewKeywordInput } from "@/data/seo/client";
import type { SeoKeyword, SeoKeywordConfidence, SeoKeywordIntent } from "@/data/seo/types";
import { KEYWORD_CONFIDENCE_LABEL, KEYWORD_INTENT_LABEL } from "@/data/seo/labels";

const INTENTS: SeoKeywordIntent[] = ["informational", "navigational", "commercial", "transactional"];
const CONFIDENCES: SeoKeywordConfidence[] = ["high", "medium", "low", "estimate"];

interface KeywordFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: SeoKeyword;
  onSubmit: (values: NewKeywordInput) => Promise<void>;
  submitError?: string;
  submitting?: boolean;
}

/** Add-or-edit a keyword within a group. A human typing a keyword directly
 *  is asserting it, not estimating it — `confidence` defaults to `"high"`
 *  on create, matching the API's own default for this endpoint
 *  (`routes/seo.ts`'s `keywordCreateSchema`). */
export function KeywordFormDialog({ open, onOpenChange, mode, initial, onSubmit, submitError, submitting }: KeywordFormDialogProps) {
  const [text, setText] = useState(initial?.text ?? "");
  const [intent, setIntent] = useState<SeoKeywordIntent | "unset">(initial?.intent ?? "unset");
  const [monthlyVolume, setMonthlyVolume] = useState(initial?.monthlyVolume?.toString() ?? "");
  const [difficulty, setDifficulty] = useState(initial?.difficulty?.toString() ?? "");
  const [confidence, setConfidence] = useState<SeoKeywordConfidence>(initial?.confidence ?? "high");
  const [textError, setTextError] = useState<string | undefined>(undefined);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setTextError("Enter a keyword or phrase.");
      return;
    }
    setTextError(undefined);
    await onSubmit({
      text: text.trim(),
      intent: intent === "unset" ? undefined : intent,
      monthlyVolume: monthlyVolume.trim() ? Number(monthlyVolume) : null,
      difficulty: difficulty.trim() ? Number(difficulty) : null,
      confidence,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Add a keyword" : "Edit keyword"}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "A phrase this brand should target that the generator missed."
                : "Adjust what you know about this keyword."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Input
              label="Keyword or phrase"
              placeholder="e.g. best freight visibility software"
              value={text}
              onChange={(e) => setText(e.target.value)}
              error={textError}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Intent</Label>
                <Select value={intent} onValueChange={(v) => setIntent(v as SeoKeywordIntent | "unset")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Unspecified</SelectItem>
                    {INTENTS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {KEYWORD_INTENT_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Confidence</Label>
                <Select value={confidence} onValueChange={(v) => setConfidence(v as SeoKeywordConfidence)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONFIDENCES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {KEYWORD_CONFIDENCE_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Monthly volume"
                type="number"
                min={0}
                placeholder="Optional"
                value={monthlyVolume}
                onChange={(e) => setMonthlyVolume(e.target.value)}
              />
              <Input
                label="Difficulty (0-100)"
                type="number"
                min={0}
                max={100}
                placeholder="Optional"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              />
            </div>

            {submitError && (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
                {submitError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              {mode === "create" ? "Add keyword" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
