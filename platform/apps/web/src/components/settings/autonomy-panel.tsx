"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lock, ShieldCheck } from "lucide-react";
import { Badge, Button, cn, useToast } from "@bebest/ui";
import { ErrorPanel } from "@/components/patterns/error-panel";
import { PageStack, Reveal } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { SectionSkeleton } from "@/components/patterns/states";
import { getAutonomy, setAutonomy, type AutonomySettings } from "@/data/organization/client";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@/data/agents/types";
import { AUTONOMY_LEVEL_DESCRIPTION, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";
import { useAsyncData } from "@/lib/use-async-data";
import { Notice } from "./form-controls";

const LEVEL_EXAMPLE: Record<AutonomyLevel, string> = {
  1: "Example: the GEO Agent measures your visibility and lists what to fix. You decide what happens next.",
  2: "Example: the SEO Agent turns its findings into draft recommendations in your queue for review.",
  3: "Example: the Growth Agent proposes a single action you can approve in one click.",
};

function planName(plan: string): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "current";
}

/**
 * Settings > Autonomy — the organization's ceiling for every agent run
 * (`GET|PUT /orgs/me/autonomy`). Each run still picks its own level on the
 * Agents page; this caps what it may pick. Levels above the plan's cap are
 * shown but locked, with the reason. Non-admins (`canEdit: false`) get the
 * same explanation read-only. Level 4 is never offered anywhere.
 */
export function AutonomyPanel() {
  const { reload, ...state } = useAsyncData(getAutonomy, []);
  const [seededFrom, setSeededFrom] = useState<AutonomySettings | null>(null);
  const [saved, setSaved] = useState<AutonomySettings | null>(null);
  const [selected, setSelected] = useState<AutonomyLevel>(1);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const groupName = useId();
  const legendId = useId();

  if (state.status === "success" && state.data !== seededFrom) {
    setSeededFrom(state.data);
    setSaved(state.data);
    setSelected(state.data.level);
  }

  if (state.status === "error") {
    return <ErrorPanel title="Autonomy settings didn't load" message={state.error.message} onRetry={reload} />;
  }

  if (!saved) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading autonomy settings…</span>
        <SectionSkeleton lines={4} titleWidth="w-36" />
        <SectionSkeleton lines={3} titleWidth="w-44" />
      </div>
    );
  }

  const dirty = selected !== saved.level;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await setAutonomy(selected);
      setSaved(updated);
      setSelected(updated.level);
      toast({
        title: `Agents are now limited to ${AUTONOMY_LEVEL_LABEL[updated.level]}`,
        description: "Applies to every agent run started from now on.",
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Couldn't change the autonomy limit", description: err instanceof Error ? err.message : "Try again in a moment.", variant: "danger" });
    } finally {
      setSaving(false);
    }
  }

  const capCopy =
    saved.planMax === null
      ? `Your ${planName(saved.plan)} plan doesn't cap autonomy — any level up to 3 can be chosen.`
      : `Your ${planName(saved.plan)} plan allows agents up to Level ${saved.maxAllowed}.`;

  return (
    <PageStack>
      {!saved.agentsAvailable && (
        <Reveal>
          <Notice
            tone="warning"
            title={`Agents aren't included in the ${planName(saved.plan)} plan`}
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/settings?tab=billing">View plans</Link>
              </Button>
            }
          >
            You can still set the limit now — it applies as soon as agents are available.
          </Notice>
        </Reveal>
      )}

      {!saved.canEdit && (
        <Reveal>
          <Notice tone="locked" title="View only">
            Only an owner or admin can change how far agents may act. Agents in this organization are limited to{" "}
            {AUTONOMY_LEVEL_LABEL[saved.effectiveMax]}.
          </Notice>
        </Reveal>
      )}

      <form onSubmit={handleSave} noValidate>
        <Section
          title="Organization autonomy limit"
          description={capCopy}
          actions={
            <Badge variant="accent" size="sm">
              Limit: Level {saved.effectiveMax}
            </Badge>
          }
          footer={
            saved.canEdit ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(saved.level)} disabled={!dirty || saving}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={saving} disabled={!dirty || saving}>
                  Save limit
                </Button>
              </>
            ) : undefined
          }
          flush
        >
          <fieldset aria-labelledby={legendId} disabled={!saved.canEdit || saving} className="min-w-0">
            <legend id={legendId} className="sr-only">
              Highest autonomy level any agent run may use
            </legend>
            <div className="flex flex-col gap-2.5 p-4 sm:p-5">
              {AUTONOMY_LEVELS.map((level) => {
                const lockedByPlan = level > saved.maxAllowed;
                const checked = selected === level;
                const id = `${groupName}-${level}`;
                return (
                  <label
                    key={level}
                    htmlFor={id}
                    className={cn(
                      "group relative flex items-start gap-3.5 rounded-xl border p-4 transition-colors duration-150 motion-reduce:transition-none",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                      checked ? "border-accent bg-accent-muted/40" : "border-border bg-surface-raised",
                      lockedByPlan || !saved.canEdit ? "cursor-not-allowed" : "cursor-pointer hover:border-border-strong",
                      lockedByPlan && "opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name={groupName}
                      value={level}
                      checked={checked}
                      disabled={lockedByPlan}
                      onChange={() => setSelected(level)}
                      aria-describedby={`${id}-desc`}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        checked ? "border-accent bg-accent text-accent-foreground" : "border-border-strong bg-surface",
                      )}
                    >
                      {checked && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium text-foreground">{AUTONOMY_LEVEL_LABEL[level]}</span>
                        {level === saved.level && (
                          <Badge variant="neutral" size="sm">
                            Current
                          </Badge>
                        )}
                        {lockedByPlan && (
                          <Badge variant="outline" size="sm">
                            <Lock size={10} aria-hidden="true" /> Not in your plan
                          </Badge>
                        )}
                      </span>
                      <span id={`${id}-desc`} className="flex flex-col gap-1">
                        <span className="text-[12.5px] leading-relaxed text-muted-foreground">{AUTONOMY_LEVEL_DESCRIPTION[level]}</span>
                        <span className="text-[12px] leading-relaxed text-subtle-foreground">{LEVEL_EXAMPLE[level]}</span>
                        {lockedByPlan && <span className="sr-only">Unavailable on your current plan.</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Section>
      </form>

      <Section
        title="What agents never do"
        icon={<ShieldCheck size={14} />}
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/agents">
              Go to Agents <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <li>Act fully autonomously — Level 4 is blocked by the server and can&apos;t be selected anywhere.</li>
          <li>Publish anything. Approving a Level 3 action records your decision; execution is a separate step.</li>
          <li>Touch billing, security, or account settings at any level.</li>
        </ul>
      </Section>
    </PageStack>
  );
}
