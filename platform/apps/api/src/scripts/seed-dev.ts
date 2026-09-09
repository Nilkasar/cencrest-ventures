/**
 * Development bootstrap — creates the one thing the CRM cannot run without
 * (BeBest's own internal operations organization, see lib/internal-org.ts)
 * plus, optionally, a small sample CRM dataset so the Leads/Deals/Accounts
 * screens have something real to render.
 *
 *   pnpm --filter @bebest/api run seed:dev               # org + staff users
 *   pnpm --filter @bebest/api run seed:dev -- --samples  # + sample CRM rows
 *
 * Idempotent: every write is keyed on a natural unique column
 * (`users.email`, `organizations.slug`) or guarded by an existence check, so
 * re-running it never duplicates anything. Sample rows sit behind a flag —
 * the bootstrap half is safe anywhere, the sample half belongs in dev only.
 *
 * Prints the `CRM_INTERNAL_ORG_ID` value to put in the API's environment.
 */
import {
  db,
  withOrgContext,
  withUserContext,
  type activity_type,
  type deal_stage,
  type lead_source,
  type lead_status,
  type role,
} from '@bebest/database';

const WITH_SAMPLES = process.argv.includes('--samples');

const OPS_ORG = { name: 'BeBest Operations', slug: 'bebest-ops' };

const STAFF: { email: string; name: string; role: role }[] = [
  { email: 'ops@bebestwithai.com', name: 'Nilesh Kasar', role: 'owner' },
  { email: 'sales@bebestwithai.com', name: 'Ava Chen', role: 'admin' },
  { email: 'analyst@bebestwithai.com', name: 'Marcus Reid', role: 'member' },
];

interface Staff {
  id: string;
  email: string;
  name: string;
  role: role;
}

/** Indexes into a fixed list that is known non-empty, without an assertion
 *  the compiler can't check. */
function cycle<T>(items: readonly T[], index: number): T {
  const value = items[index % items.length];
  if (value === undefined) throw new Error('cycle() called on an empty list');
  return value;
}

async function main(): Promise<void> {
  const users: Staff[] = [];
  for (const staff of STAFF) {
    const user = await db.users.upsert({
      where: { email: staff.email },
      create: { email: staff.email, name: staff.name, email_verified: true },
      update: { name: staff.name },
    });
    users.push({ id: user.id, email: staff.email, name: staff.name, role: staff.role });
  }

  const [owner, sales, analyst] = users;
  if (!owner || !sales || !analyst) throw new Error('expected three seeded staff users');

  const org = await db.organizations.upsert({
    where: { slug: OPS_ORG.slug },
    create: { name: OPS_ORG.name, slug: OPS_ORG.slug, created_by: owner.id },
    update: { name: OPS_ORG.name },
  });

  // `memberships` has RLS keyed on app.current_user OR app.current_org
  // (0000_init/rls.sql, "Special case — memberships"), so these writes have
  // to run inside a context — an unscoped insert fails the WITH CHECK.
  for (const user of users) {
    await withUserContext(user.id, (tx) =>
      tx.memberships.upsert({
        where: { organization_id_user_id: { organization_id: org.id, user_id: user.id } },
        create: {
          organization_id: org.id,
          user_id: user.id,
          role: user.role,
          created_by: owner.id,
        },
        update: { role: user.role },
      }),
    );
  }

  // eslint-disable-next-line no-console -- CLI seed script, not app code
  console.log(`org:   ${org.name} (${org.slug})`);
  // eslint-disable-next-line no-console -- CLI seed script, not app code
  console.log(`users: ${users.map((u) => `${u.email} [${u.role}]`).join(', ')}`);
  // eslint-disable-next-line no-console -- CLI seed script, not app code
  console.log(`\nCRM_INTERNAL_ORG_ID=${org.id}\n`);

  if (!WITH_SAMPLES) {
    // eslint-disable-next-line no-console -- CLI seed script, not app code
    console.log('done — pass --samples to also seed sample CRM leads/deals/activities.');
    return;
  }

  await seedCrmSamples(org.id, [owner, sales, analyst]);
  // eslint-disable-next-line no-console -- CLI seed script, not app code
  console.log('done — sample CRM data seeded.');
}

interface SampleLead {
  email: string;
  name: string;
  company: string;
  category: string;
  source: lead_source;
  status: lead_status;
  score: number | null;
}

const SAMPLE_LEADS: SampleLead[] = [
  { email: 'priya@northwindlogistics.com', name: 'Priya Raman', company: 'Northwind Logistics', category: 'Freight & 3PL', source: 'free_snapshot', status: 'qualified', score: 82 },
  { email: 'dan@heliocare.io', name: 'Dan Whitfield', company: 'Heliocare', category: 'Telehealth', source: 'apply_form', status: 'contacted', score: 64 },
  { email: 'sofia@meridianlegal.co', name: 'Sofia Almeida', company: 'Meridian Legal', category: 'Legal services', source: 'referral', status: 'new', score: null },
  { email: 'tom@stackforge.dev', name: 'Tom Iyer', company: 'Stackforge', category: 'Developer tools', source: 'free_snapshot', status: 'qualified', score: 91 },
  { email: 'hana@lumenretail.com', name: 'Hana Ito', company: 'Lumen Retail', category: 'Ecommerce', source: 'direct', status: 'new', score: 47 },
  { email: 'greg@atlasbenefits.com', name: 'Greg Sandoval', company: 'Atlas Benefits', category: 'HR & benefits', source: 'apply_form', status: 'lost', score: 22 },
  { email: 'nina@verdantfoods.co', name: 'Nina Okafor', company: 'Verdant Foods', category: 'CPG', source: 'free_snapshot', status: 'contacted', score: 71 },
  { email: 'luis@portside.ai', name: 'Luis Marchetti', company: 'Portside AI', category: 'AI infrastructure', source: 'referral', status: 'new', score: 58 },
];

const DEAL_PLAN: { title: string; valueCents: number; stage: deal_stage; probability: number }[] = [
  { title: 'Northwind — AI Visibility Audit', valueCents: 4_800_000, stage: 'proposal', probability: 60 },
  { title: 'Stackforge — Audit + 90-day Strategy', valueCents: 9_500_000, stage: 'negotiation', probability: 80 },
  { title: 'Heliocare — Monitoring retainer', valueCents: 1_200_000, stage: 'qualifying', probability: 30 },
  { title: 'Verdant Foods — AI Visibility Audit', valueCents: 3_600_000, stage: 'new', probability: 15 },
  { title: 'Meridian Legal — Snapshot follow-up', valueCents: 2_400_000, stage: 'won', probability: 100 },
  { title: 'Atlas Benefits — Audit', valueCents: 3_000_000, stage: 'lost', probability: 0 },
];

const ACTIVITY_PLAN: { type: activity_type; subject: string; body: string }[] = [
  { type: 'snapshot_requested', subject: 'Free snapshot requested', body: 'Ran the 20-query sample across 4 models.' },
  { type: 'email', subject: 'Sent snapshot results', body: 'Shared the AI Visibility Score and the top 3 gaps.' },
  { type: 'call', subject: 'Discovery call', body: '30 min — walked through competitor citation share.' },
  { type: 'note', subject: 'Budget signal', body: 'Budget approved for Q4; wants the Audit first.' },
];

interface SeededLead {
  id: string;
  status: string;
  company: string | null;
  name: string;
  convertedOrgId: string | null;
}

async function seedCrmSamples(orgId: string, staff: [Staff, Staff, Staff]): Promise<void> {
  const [owner, sales, analyst] = staff;
  const assignees = [sales, analyst, owner];

  const leads: SeededLead[] = [];

  for (const [index, sample] of SAMPLE_LEADS.entries()) {
    const assignee = cycle(assignees, index);
    const row = await withOrgContext(orgId, async (tx) => {
      const existing = await tx.leads.findFirst({ where: { email: sample.email } });
      if (existing) return existing;
      return tx.leads.create({
        data: {
          organization_id: orgId,
          email: sample.email,
          name: sample.name,
          company: sample.company,
          website: `https://${sample.email.split('@')[1] ?? 'example.com'}`,
          category: sample.category,
          notes: `Seeded sample lead — ${sample.company}.`,
          source: sample.source,
          status: sample.status,
          score: sample.score,
          assigned_to: assignee.id,
          created_by: owner.id,
        },
      });
    });
    leads.push({
      id: row.id,
      status: row.status,
      company: row.company,
      name: row.name,
      convertedOrgId: row.converted_organization_id,
    });
  }

  // Convert the qualified leads, so the Accounts screen isn't empty either.
  for (const lead of leads) {
    if (lead.status !== 'qualified' || lead.convertedOrgId) continue;
    const slug = (lead.company ?? lead.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const account = await db.organizations.upsert({
      where: { slug },
      create: { name: lead.company ?? lead.name, slug, created_by: owner.id },
      update: {},
    });
    await withOrgContext(orgId, (tx) =>
      tx.leads.update({
        where: { id: lead.id },
        data: {
          converted_organization_id: account.id,
          converted_at: new Date(),
          status: 'converted',
          updated_by: owner.id,
        },
      }),
    );
    lead.convertedOrgId = account.id;
    lead.status = 'converted';
  }

  for (const [index, plan] of DEAL_PLAN.entries()) {
    const lead = cycle(leads, index);
    const dealOwner = cycle([sales, owner], index);
    await withOrgContext(orgId, async (tx) => {
      const existing = await tx.deals.findFirst({ where: { title: plan.title } });
      if (existing) return;
      await tx.deals.create({
        data: {
          organization_id: orgId,
          lead_id: lead.id,
          account_organization_id: lead.convertedOrgId,
          title: plan.title,
          value_cents: plan.valueCents,
          currency: 'USD',
          stage: plan.stage,
          probability: plan.probability,
          expected_close_date: new Date(Date.now() + (index + 2) * 7 * 86_400_000),
          owner_id: dealOwner.id,
          lost_reason: plan.stage === 'lost' ? 'Went with an in-house SEO hire instead.' : null,
          created_by: owner.id,
        },
      });
    });
  }

  for (const [index, lead] of leads.entries()) {
    const plan = cycle(ACTIVITY_PLAN, index);
    const actor = cycle(assignees, index);
    await withOrgContext(orgId, async (tx) => {
      const existing = await tx.activities.findFirst({
        where: { lead_id: lead.id, subject: plan.subject },
      });
      if (existing) return;
      await tx.activities.create({
        data: {
          organization_id: orgId,
          lead_id: lead.id,
          account_organization_id: lead.convertedOrgId,
          type: plan.type,
          subject: plan.subject,
          body: plan.body,
          metadata: {},
          actor_id: actor.id,
        },
      });
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
