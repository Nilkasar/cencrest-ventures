"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Badge, Button } from "@bebest/ui";
import { PageStack } from "@/components/patterns/motion";
import { Section } from "@/components/patterns/section";
import { typography } from "@/components/patterns/typography";
import { AUTONOMY_LEVELS } from "@/data/agents/types";
import { AUTONOMY_LEVEL_DESCRIPTION, AUTONOMY_LEVEL_LABEL } from "@/data/agents/labels";

/**
 * Settings > Autonomy. Autonomy isn't an org-wide switch in this build —
 * it's chosen per agent run on the Agents page (`triggerAgentRun`'s
 * `autonomyLevel`, default 1), and the backend hard-blocks Level 4. This
 * tab explains the ladder and where it's set, rather than pretending to a
 * setting that doesn't exist.
 */
export function AutonomyPanel() {
  return (
    <PageStack>
      <Section
        title="Agent autonomy"
        description="How far an agent may go on its own. You choose the level each time you run an agent."
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/agents">
              Go to Agents <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </Button>
        }
        flush
      >
        <ol className="divide-y divide-border">
          {AUTONOMY_LEVELS.map((level) => (
            <li key={level} className="flex items-start gap-3.5 px-5 py-4">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-[12px] font-medium text-foreground"
                aria-hidden="true"
              >
                {level}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-medium text-foreground">{AUTONOMY_LEVEL_LABEL[level]}</p>
                  {level === 1 && (
                    <Badge variant="neutral" size="sm">
                      Default
                    </Badge>
                  )}
                </div>
                <p className={typography.secondary}>{AUTONOMY_LEVEL_DESCRIPTION[level]}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="What agents never do" icon={<ShieldCheck size={14} />}>
        <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <li>Act fully autonomously — Level 4 is blocked by the server and can&apos;t be selected anywhere.</li>
          <li>Publish anything. Approving a Level 3 action records your decision; execution is a separate step.</li>
          <li>Touch billing, security, or account settings at any level.</li>
        </ul>
      </Section>
    </PageStack>
  );
}
