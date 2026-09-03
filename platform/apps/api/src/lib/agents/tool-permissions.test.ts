import { describe, expect, it } from 'vitest';
import { canPerformTool, allowedToolsFor } from './tool-permissions.js';
import { AGENT_NAMES, type ToolName } from './types.js';

const HARD_BLOCKED_TOOLS: ToolName[] = [
  'modify_billing',
  'change_user_permissions',
  'access_other_org_data',
  'send_external_email',
  'publish_content',
  'create_content_draft',
];

describe('canPerformTool — hard-blocked actions (this epic\'s own hard constraints)', () => {
  it.each(AGENT_NAMES)('%s can never modify_billing / change_user_permissions / access_other_org_data / send_external_email', (agentName) => {
    for (const tool of HARD_BLOCKED_TOOLS) {
      expect(canPerformTool(agentName, { tool })).toBe(false);
    }
  });

  it.each(AGENT_NAMES)('%s can never publish_content — this epic stops at "approved," Epic 13 executes', (agentName) => {
    expect(canPerformTool(agentName, { tool: 'publish_content' })).toBe(false);
  });

  it('the prohibited set wins even if a caller tries every agent name', () => {
    for (const agentName of AGENT_NAMES) {
      for (const tool of HARD_BLOCKED_TOOLS) {
        expect(canPerformTool(agentName, { tool })).toBe(false);
      }
    }
  });
});

describe('canPerformTool — per-agent allowlist (docs/13-agents/AGENT_ARCHITECTURE.md\'s Tool Use table)', () => {
  it('geo_agent can run_ai_query (GEO/Research/Growth agents per the doc)', () => {
    expect(canPerformTool('geo_agent', { tool: 'run_ai_query' })).toBe(true);
  });

  it('geo_agent cannot analyze_page (SEO/Research agents only per the doc)', () => {
    expect(canPerformTool('geo_agent', { tool: 'analyze_page' })).toBe(false);
  });

  it('seo_agent can analyze_page', () => {
    expect(canPerformTool('seo_agent', { tool: 'analyze_page' })).toBe(true);
  });

  it('seo_agent cannot run_ai_query (not an SEO-agent tool per the doc)', () => {
    expect(canPerformTool('seo_agent', { tool: 'run_ai_query' })).toBe(false);
  });

  it('growth_agent can both run_ai_query and analyze_page — it composes GEO + SEO', () => {
    expect(canPerformTool('growth_agent', { tool: 'run_ai_query' })).toBe(true);
    expect(canPerformTool('growth_agent', { tool: 'analyze_page' })).toBe(true);
  });

  it.each(AGENT_NAMES)('%s can use the "all agents" tools: crawl_url, search_web, query_database, send_notification, create_recommendation, create_content_brief', (agentName) => {
    for (const tool of ['crawl_url', 'search_web', 'query_database', 'send_notification', 'create_recommendation', 'create_content_brief'] as const) {
      expect(canPerformTool(agentName, { tool })).toBe(true);
    }
  });
});

describe('allowedToolsFor', () => {
  it('never includes a hard-blocked tool for any agent', () => {
    for (const agentName of AGENT_NAMES) {
      const allowed = allowedToolsFor(agentName);
      for (const tool of HARD_BLOCKED_TOOLS) {
        expect(allowed).not.toContain(tool);
      }
    }
  });
});
