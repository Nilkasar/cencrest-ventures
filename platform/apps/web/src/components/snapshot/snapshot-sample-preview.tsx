import { Badge } from "@bebest/ui";

/**
 * A miniature of what the finished snapshot report actually shows, so a
 * visitor on the intake page can see the shape of the deliverable before
 * handing over their email. The intake page was previously a bare form in a
 * narrow column, which gave a first-time visitor nothing to judge the offer
 * by.
 *
 * EVERY NUMBER HERE IS INVENTED and must stay visibly labelled as such. The
 * figures are hard-coded constants, not a sample of anyone's real data, and
 * they are not a prediction of what a given brand will score. This mirrors
 * the correction already made on the marketing site, where an illustrative
 * figure carried a real-looking "SAMPLED 06 AUG 2026" date and had to be
 * relabelled `ILLUSTRATIVE` — presenting invented numbers as measurement is
 * the one thing this product cannot do, on any surface. Hence the `Example`
 * badge in the header, the `aria-label` on the region, and the footnote.
 */

/** Invented per-model figures. Deliberately unflattering and uneven: a row of
 *  strong scores would read as a promise about the visitor's own result. */
const EXAMPLE_MODELS = [
  { model: "ChatGPT", score: 41 },
  { model: "Gemini", score: 38 },
  { model: "Claude", score: 29 },
  { model: "Perplexity", score: 26 },
] as const;

const EXAMPLE_OVERALL = 34;

export function SnapshotSamplePreview() {
  return (
    <section
      aria-label="Example snapshot report with illustrative figures"
      className="rounded-xl border border-border bg-surface-raised shadow-sm overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
          Your snapshot report
        </p>
        <Badge variant="outline" size="sm">
          Example
        </Badge>
      </header>

      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[12px] text-muted-foreground">AI Visibility Score</p>
            <p className="flex items-baseline gap-1">
              <span className="font-display text-[40px] font-semibold leading-none tracking-[-0.03em] text-foreground">
                {EXAMPLE_OVERALL}
              </span>
              <span className="text-[15px] text-subtle-foreground">/ 100</span>
            </p>
          </div>
          <p className="text-right text-[12px] leading-relaxed text-muted-foreground max-w-[19ch]">
            How often four AI models name you in category buying questions.
          </p>
        </div>

        <dl className="flex flex-col gap-2.5">
          {EXAMPLE_MODELS.map(({ model, score }) => (
            <div key={model} className="flex items-center gap-3">
              <dt className="w-[76px] shrink-0 text-[12.5px] text-muted-foreground">{model}</dt>
              {/* Bar is decorative: the number is in the <dd>, so a screen
                  reader gets the value from text without a redundant meter. */}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                <div className="h-full rounded-full bg-accent" style={{ width: `${score}%` }} />
              </div>
              <dd className="w-[34px] shrink-0 text-right font-mono text-[12px] tabular-nums text-foreground">
                {score}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-[12px] text-muted-foreground">
            <span className="text-foreground">Top competitor gap — </span>
            the brand AI recommends most in this example category appears in roughly twice as many answers.
          </p>
          <p className="text-[11.5px] leading-relaxed text-subtle-foreground">
            Illustrative figures, shown to explain the format. Your snapshot reports your own measured numbers.
          </p>
        </div>
      </div>
    </section>
  );
}
