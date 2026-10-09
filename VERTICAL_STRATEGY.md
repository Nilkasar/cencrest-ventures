# Go-to-market: sell into ONE vertical, not six

**Recommendation: pick a single category and sell only into it until roughly client 20.**

This is not a branding preference or a focus platitude. The product's own query
generator makes cross-vertical reuse **exactly zero** and same-vertical reuse
**24–82%**, and that single structural fact decides the unit economics, the
defensibility, and whether the headline feature — a competitive benchmark — can
exist at all. The numbers below come from running
`platform/apps/api/src/lib/query-generator.ts`, not from an estimate.

---

## 1. The measurement

`generateCandidateQueries` builds a brand's query universe from ten template
families. Nine of them interpolate the **category** string; exactly one contains
the **brand** name:

| Template family | Shape | Depends on |
|---|---|---|
| category | `What is {category}?` | category only |
| authority | `Who are the experts in {category}?` | category only |
| commercial | `Best {category} for {use case}?` | category + use case |
| industry | `Best {category} for {industry}?` | category + industry |
| size | `Best {category} for {size} companies?` | category + size |
| geography | `Best {category} in {market}?` | category + market |
| feature | `Which {category} has {differentiator}?` | category + differentiator |
| problem | `How do I solve {pain point}?` | use case |
| intent | `How to {solution}?` | use case |
| **comparison** | **`{brand} vs {competitor}`** | **the brand itself** |

Running two brand profiles through the real generator and counting **identical
query strings**:

| Second brand vs. the first | Reusable |
|---|---|
| Same category, same positioning | **82%** |
| Same category, one use case in common | **53%** |
| Same category, no use case in common | **24%** |
| **Different category** | **0%** |

And only **2 of 17** generated queries contain the brand name at all — all of
them in the `comparison` family.

Two readings of the same number:

- **Cross-vertical reuse is 0%, and it is structurally 0%, not coincidentally
  low.** Every reusable template interpolates `{category}`. A dental client and a
  freight client share literally no query text. Six verticals means paying the
  cold-start cost six times, forever.
- **Within a category, most of the work is the same work.** The floor is 24% —
  the category/authority/geography/industry/size families, which need nothing
  about the customer but the category they compete in. It rises toward 82% as two
  clients' positioning converges, which is precisely what direct competitors'
  positioning does.

---

## 2. Today none of that reuse is captured

`query_sets` and `queries` are keyed by `organization_id` **and** `brand_id`, and
RLS is `FORCE`d on both. Every client's universe is generated fresh, stored under
their own org, and executed against 4 models at full price. There is no path that
reads another org's rows — verified: no cross-org aggregate query exists anywhere
in the AI-visibility or scoring code.

So the cost curve is flat. Client 20 costs exactly what client 1 cost. For a
business whose COGS is metered AI spend, a flat cost curve with a fixed price is
the whole margin problem.

**A vertical is what converts that flat line into a declining one** — but only if
the reuse is actually captured. Which makes the next point the important one.

---

## 3. This decision and the response-cache decision are the same decision

The open data-policy question — *is a model's answer about a category customer
data?* — has been the blocker on the 60–80% COGS lever. The measurement above
answers it, because it shows the two kinds of query are cleanly separable:

- `Best dental practice management software for small companies?` — contains no
  customer's name, no customer's data, and no customer's secret. It is a
  **market observation**. Two clients asking it are asking the same question
  about the world.
- `DentalFlow vs Dentrix` — contains the client's brand. Customer-specific.

That is a defensible cache boundary that needs no judgement call per query: cache
on `(query_text, model, prompt_version)`, **never** on org, and exclude the
`comparison` family. It is not a cross-tenant data leak, because nothing
tenant-derived enters the key or the value — the input is a category string the
client does not own, and the output is what a public model said about a public
market.

**And it only pays off inside one vertical.** Cache hit rate across six verticals
is ~0% by the table above. Inside one, it approaches the 24–82% band and climbs
as the client base concentrates. The cache is worth building *because* of the
vertical, and close to worthless without it.

> Caveat worth stating plainly: a cache makes the score a function of *when the
> answer was fetched*. The product's claim is measurement, so cached entries need
> a TTL short enough that "we measured this" stays true, and the report should
> say which entries were re-fetched versus reused. That is a real design
> constraint, not a reason to skip the lever.

---

## 4. The benchmark only exists in a vertical

The AVS is a number. A number alone is weak: a client told "your AI Visibility
Score is 34" has no way to know whether that is good.

*"You are 4th of 11 in dental practice management software, and Dentrix is cited
by 3 sources you appear in zero times"* is a different product. It is the thing
worth paying for, and it is the thing an SEO agency with a ChatGPT subscription
cannot reproduce.

That benchmark requires **N clients in one category**, measured against a
**shared query set**, because scores computed from different query universes are
not comparable to each other. Six verticals gives N=1 per category and therefore
no benchmark in any of them. One vertical gives a benchmark at around client 5
and a moat by client 20 — the comparison set itself becomes the asset, and it is
an asset a competitor cannot buy, only accumulate.

Note this does **not** exist today: there is no cross-org aggregate read in the
codebase, by design. Building it is a deliberate step, and it needs the same
care as the cache — the benchmark a client sees must be aggregate and
non-identifying, never "here is what your named competitor's own dashboard says."

---

## 5. What compounds per vertical, and what does not

| Asset | Reusable across clients in one vertical? | Across verticals? |
|---|---|---|
| Query universe (24–82% of it) | Yes | **No — 0%** |
| Citation source map (which publications the models actually read) | Yes, largely | No |
| Competitor set | Yes, nearly identical | No |
| Category benchmark / percentile | Yes — and needs N | No |
| Sales proof ("we measured 11 of your competitors") | Yes, compounding | No |
| The platform itself | Yes | Yes |

Only the last row is vertical-agnostic. Everything that makes the *audit* good
rather than merely automated is per-category.

---

## 6. Which vertical

Choosing it is the user's call — it depends on network and credibility, which no
code analysis can supply. The criteria that follow from the analysis above:

1. **A category buyers name the same way.** The templates interpolate a literal
   category string; if half the market calls it "practice management" and half
   "dental CRM", the reuse and the benchmark both fragment.
2. **A bounded, knowable competitor set (roughly 8–20 named players).** Too few
   and there is no benchmark; too many and the comparison set never saturates.
3. **A category where being un-recommended is expensive** — considered purchases
   with real deal sizes, where AI recommendations plausibly enter the buying
   process. This is the willingness-to-pay test.
4. **Reachable decision-makers, ideally through existing network.** At a $10k+
   audit price, the first ten clients come from conversations, not funnels.
5. **Evidence the models actually have opinions about the category.** Cheap to
   test before committing: run the free Snapshot flow against 3–4 players in the
   candidate category. If all four models answer vaguely and cite nothing, there
   is no gap to sell closing. **Do this before picking** — it costs a few dollars
   of AI spend and is the only one of these five criteria the platform itself can
   answer.

---

## 7. What this means concretely

- Pick one category, using criterion 5 as the tiebreaker.
- Say no to out-of-category inbound until ~client 20, or take it at a price that
  explicitly covers the 0%-reuse cold start.
- Build the response cache scoped to `(query_text, model, prompt_version)`,
  excluding the `comparison` family, with a TTL the report discloses.
- Keep the category's query set versioned and shared as the benchmark spine, so
  scores stay comparable across clients.
- Revisit at ~20 clients. A second vertical then starts from 0% reuse again, but
  by that point the first one is funding it — and the playbook for entering a
  category is itself the transferable asset.

---

## 8. Honest limits of this analysis

- The 82 / 53 / 24 / 0 figures come from brand profiles I constructed to span a
  realistic range of similarity, not from customer data — there is none yet. The
  **0% cross-vertical** figure is structural and holds for any inputs, because
  every reusable template interpolates the category. The same-vertical band moves
  with how similar two clients' stated use cases are, so treat 24% as the
  dependable floor and 82% as the optimistic ceiling.
- Reuse is measured as **identical query strings**. Semantically equivalent
  phrasings would raise the real figure and are not counted here.
- Whether the cache boundary in §3 is acceptable is a business and legal
  judgement, not a technical one. The analysis shows the boundary is *clean* and
  that the market-observation queries contain nothing tenant-derived; it does not
  make the decision.
- Nothing here has been validated against a paying customer. It is an argument
  from the product's structure, which is the strongest evidence available before
  revenue exists — and weaker than one real sales conversation.
