import type { Agent, AgentName, AutonomyLevel } from './types.js';
import { GeoAgent } from './geo-agent.js';
import { SeoAgent } from './seo-agent.js';
import { GrowthAgent } from './growth-agent.js';

/** The one place a concrete `Agent` is constructed. `autonomyLevel` here is
 * ALWAYS a value that has already passed `autonomy.ts`'s
 * `resolveRequestedAutonomyLevel` — never a raw caller-supplied number —
 * enforced at the type level (`AutonomyLevel` excludes 4 entirely). */
export function createAgent(name: AgentName, autonomyLevel: AutonomyLevel): Agent {
  switch (name) {
    case 'geo_agent':
      return new GeoAgent(autonomyLevel);
    case 'seo_agent':
      return new SeoAgent(autonomyLevel);
    case 'growth_agent':
      return new GrowthAgent(autonomyLevel);
  }
}
