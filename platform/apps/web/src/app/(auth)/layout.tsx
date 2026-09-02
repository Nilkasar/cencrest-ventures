export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-ink-950 text-ink-0 px-14 py-12">
        <div className="flex items-center gap-2">
          <span className="font-display text-[20px] font-semibold tracking-[-0.02em]">BeBest</span>
          <span className="size-1.5 rounded-full bg-verdant-400" aria-hidden="true" />
        </div>
        <blockquote className="max-w-md">
          <p className="font-display text-[26px] leading-snug tracking-[-0.01em] text-ink-0/95">
            &ldquo;The brands that dominate AI answers aren&apos;t the best — they&apos;re the most
            retrievable.&rdquo;
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-0/40">
            Product Vision · BeBest
          </p>
        </blockquote>
        <p className="text-[12.5px] text-ink-0/35 max-w-sm leading-relaxed">
          1,400+ buying questions, run across four AI models, mapped to every citation and traced to its source.
        </p>
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
