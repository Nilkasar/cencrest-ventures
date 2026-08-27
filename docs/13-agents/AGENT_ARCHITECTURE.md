# AGENT ARCHITECTURE — BeBest

**Version**: 1.0  
**Date**: 2026-08-11

---

## OVERVIEW

BeBest agents are AI-powered systems that automate the growth intelligence loop. Each agent specializes in a domain, runs in the background, and produces actionable outputs that humans review before anything changes.

**Key principle**: Agents recommend and draft. Humans approve. Agents execute (at higher autonomy levels, with explicit opt-in).

---

## AGENT TYPES

### 1. GEO Agent (Epic 17)
**Domain**: AI visibility intelligence  
**Responsibilities**:
- Load brand profile and competitor list
- Generate query universe for brand's category
- Execute queries across configured AI providers
- Extract and score brand mentions, competitor mentions, citations
- Identify gaps and opportunities
- Generate evidence-backed GEO recommendations
- Re-run measurements after changes

**Runs**: On-demand (triggered by user or schedule)  
**Output**: AI Visibility Score + gap analysis + prioritized recommendations

### 2. SEO Agent (Epic 18)
**Domain**: Search engine intelligence  
**Responsibilities**:
- Crawl and analyze customer website
- Analyze competitor websites
- Build intent graph for category
- Identify keyword gaps and content opportunities
- Create content briefs
- Generate content drafts (with approval gate)
- Identify technical SEO issues
- Track SEO performance changes

**Runs**: On-demand (triggered by user or schedule)  
**Output**: SEO health score + opportunity list + content briefs

### 3. Content Agent (part of Epic 16)
**Domain**: Content creation  
**Responsibilities**:
- Receive content brief (from SEO or GEO agent)
- Research evidence and claims
- Generate content outline
- Generate full content draft
- Run quality checks (fact, brand, duplicate, SEO, GEO)
- Present for human approval
- Publish on approval (Level 3+ only)

**Runs**: Triggered by approved content brief  
**Output**: Draft content + quality check report

### 4. Research Agent (part of Epics 4, 5)
**Domain**: Brand and market research  
**Responsibilities**:
- Gather information about a brand from its website
- Identify category positioning
- Discover competitors
- Extract brand claims and evidence
- Build initial brand intelligence profile

**Runs**: On onboarding / profile setup  
**Output**: Draft brand intelligence profile for human review

### 5. Competitor Agent (Epic 11)
**Domain**: Competitive intelligence  
**Responsibilities**:
- Track competitor AI visibility over time
- Track competitor website changes
- Identify competitor content strategies
- Map competitor citation patterns
- Alert when competitor visibility changes significantly

**Runs**: Scheduled (weekly by default)  
**Output**: Competitor intelligence report + movement alerts

### 6. Measurement Agent (Epic 22)
**Domain**: Outcome measurement  
**Responsibilities**:
- Run AI visibility re-test after a change
- Compare scores before/after
- Attribute changes to specific actions
- Update the learning model with observed outcomes
- Generate measurement report

**Runs**: Triggered automatically 4 weeks after an action is published  
**Output**: Before/after comparison + attribution estimate

### 7. Unified Growth Agent (Epic 19)
**Domain**: End-to-end growth orchestration  
**Capabilities**: Combines all specialized agents  
**Responsibilities**:
- Orchestrate the full growth loop
- Prioritize actions across SEO and GEO
- Produce a unified growth action plan
- Track outcomes across all actions

**Runs**: On-demand (weekly cadence recommended)  
**Output**: Unified growth plan with prioritized actions

---

## AGENT ARCHITECTURE

### Agent Structure

Every agent follows this pattern:

```typescript
interface Agent {
  name: string;
  version: string;
  autonomyLevel: 1 | 2 | 3 | 4;
  
  // Called by agent runner
  run(context: AgentContext): AsyncGenerator<AgentEvent>;
  
  // Can the agent perform this action?
  canPerform(action: Action): boolean;
}

interface AgentContext {
  organizationId: string;
  brandId: string;
  triggeredBy: 'user' | 'schedule' | 'event';
  triggeredById?: string;  // user ID if user-triggered
  parameters: Record<string, unknown>;
  aiProvider: AIProvider;
  db: Database;
  logger: Logger;
}

type AgentEvent =
  | { type: 'progress'; message: string; step: number; totalSteps: number }
  | { type: 'observation'; observation: string; evidence?: string }
  | { type: 'recommendation'; recommendation: Recommendation }
  | { type: 'draft'; content: ContentDraft }
  | { type: 'action_required'; action: PendingAction }
  | { type: 'complete'; summary: string; resultId: string }
  | { type: 'error'; message: string; fatal: boolean };
```

### Agent Runner

The agent runner manages agent lifecycle:

```
1. Receive trigger (user request, schedule, event)
2. Load agent configuration and context
3. Check permissions (can this organization run this agent at this autonomy level?)
4. Create agent run record in database
5. Execute agent in background job
6. Stream events to client (if user-triggered)
7. Store all events in database
8. On completion, create result record
9. Notify user (email + in-app)
10. If autonomy level allows, execute approved actions automatically
```

---

## TOOL USE

Agents may use the following tools (based on permissions):

| Tool | Description | Permission |
|---|---|---|
| `crawl_url` | Crawl a public URL | All agents |
| `search_web` | Search public web (via configured provider) | All agents |
| `run_ai_query` | Run a query against an AI provider | GEO, Research, Growth agents |
| `analyze_page` | Analyze a crawled page for SEO | SEO, Research agents |
| `query_database` | Read brand/competitor/opportunity data | All agents |
| `create_recommendation` | Write a recommendation to database | All agents |
| `create_content_brief` | Create a content brief | SEO, GEO, Growth agents |
| `create_content_draft` | Generate a draft | Content agent |
| `publish_content` | Publish approved content | Content agent (Level 3+ only) |
| `send_notification` | Send notification to user | All agents |

Agents cannot:
- Modify billing
- Change user permissions
- Access other organizations' data
- Send emails directly to external addresses (except notifications)
- Execute code outside the tool list

---

## PROMPT INJECTION PROTECTION

Agents are designed to be resistant to prompt injection:

1. **System prompt is not revealed to tools** — The agent's system instructions are not passed to tool outputs
2. **Tool outputs are treated as data** — Content from crawled pages, AI responses, or user input is formatted as data blocks, never as instructions
3. **Structured extraction** — Rather than asking "what does this page say?", extract specific structured fields
4. **Validation** — Tool outputs are validated against expected schemas before processing
5. **Logging** — All tool calls and outputs are logged for audit

---

## AGENT EVALUATION

Agent output quality is measured, not assumed.

### GEO Agent Evaluation
- Accuracy of brand mention detection (vs. human-labeled ground truth)
- Accuracy of competitor detection
- Quality of recommendations (human evaluation rubric)
- Gap between generated recommendations and what an expert would recommend

### SEO Agent Evaluation
- Accuracy of technical issue detection (vs. known issues)
- Relevance of keyword opportunities identified
- Quality of content briefs (human evaluation rubric)

### Content Agent Evaluation
- Factual accuracy of generated content (human review)
- SEO optimization score of generated content
- Brand voice consistency score
- Readability score (Flesch-Kincaid or equivalent)

---

## AUTONOMY LEVELS IN PRACTICE

### Level 1 — Recommend Only
- Agent runs and produces recommendations
- Recommendations displayed in dashboard
- Human decides which to act on
- Human implements manually

### Level 2 — Draft
- Agent produces recommendations + draft content
- Draft displayed for human review
- Human edits, approves, and implements

### Level 3 — Approve & Execute
- Agent produces draft + presents for one-click approval
- Human reviews and approves with single action
- Agent executes (publishes, updates, implements)
- Action logged to audit trail
- Rollback available for 30 days

### Level 4 — Autonomous (Within Guardrails)
- Agent acts within pre-configured parameters
- Requires explicit `AUTONOMOUS_MODE=true` setting per organization
- All actions logged to audit trail immediately
- Human receives notification after action (not before)
- Rollback available for 30 days
- Prohibited actions list enforced regardless of autonomy level
- Weekly review report of all autonomous actions

**Level 4 is NOT available in Phase 1–6. It is designed for Phase 10.**

---

## AGENT OBSERVABILITY

Every agent run is observable:

```
Agent Run Record:
- run_id
- agent_name + version
- organization_id + brand_id
- triggered_by + triggered_at
- status (queued, running, completed, failed)
- steps_completed / total_steps
- events (full log)
- result_id (link to result)
- tokens_used
- latency_ms
- completed_at
- error (if failed)
```

Customers can see:
- What the agent did (step-by-step)
- What observations it made
- What evidence it found
- What recommendations it produced
- How long it took
- How many AI tokens it used

This transparency is a trust differentiator.
