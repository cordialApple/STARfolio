// A seeded bank for the retrieval eval: 10 target experiences that each answer one themed
// query, plus 10 plausible distractors so top-3 retrieval is non-trivial.

export interface EvalExperience {
  title: string
  situation: string
  task: string
  action: string
  result_text: string
}

export const EVAL_BANK: EvalExperience[] = [
  {
    title: 'Shipped the launch after the tech lead quit',
    situation: 'Our tech lead resigned two weeks before a hard launch date and the team panicked.',
    task: 'I stepped up to keep the release on track without a clear owner.',
    action: 'I triaged the remaining work, split it across the team, and ran daily check-ins to unblock people fast.',
    result_text: 'We shipped on the original date with no major regressions.'
  },
  {
    title: 'Defined a roadmap from a vague mandate',
    situation: 'Leadership said only "make onboarding better" with no specs, metrics, or scope.',
    task: 'I had to turn an ambiguous ask into a concrete plan.',
    action: 'I interviewed users, mapped the drop-off points, framed three options, and picked one with a rationale.',
    result_text: 'The plan was approved and drop-off in the first session fell by a third.'
  },
  {
    title: 'Mediated a standoff between design and engineering',
    situation: 'Design and engineering were deadlocked over a redesign and had stopped talking.',
    task: 'I wanted to get both sides back to a shared decision.',
    action: 'I ran a session where each side stated constraints, then facilitated a compromise we all signed off on.',
    result_text: 'The feature shipped and the two teams kept collaborating afterward.'
  },
  {
    title: 'Convinced leadership to adopt a new framework',
    situation: 'I believed our stack was holding us back but had no authority to change it.',
    task: 'I needed buy-in from skeptical senior leaders.',
    action: 'I built a small proof of concept, wrote up the trade-offs, and walked leadership through the migration risk.',
    result_text: 'They approved the switch and it became the default for new services.'
  },
  {
    title: 'Owned a production outage I caused',
    situation: 'I pushed a change that took the app down during peak hours — it was my mistake.',
    task: 'I had to fix it, own the failure honestly, and learn from it.',
    action: 'I rolled back immediately, wrote a candid postmortem admitting my error, and added a review gate.',
    result_text: 'We recovered within the hour, and the lesson I learned changed how carefully I ship.'
  },
  {
    title: 'Brought a struggling intern up to speed',
    situation: 'A new intern was overwhelmed and falling behind in their first month.',
    task: 'I wanted to help them become productive and confident.',
    action: 'I paired with them daily, broke work into small wins, and wrote a starter guide for the codebase.',
    result_text: 'They shipped their first feature in week three and got a return offer.'
  },
  {
    title: 'Cut features using usage analytics',
    situation: 'Our product was bloated and nobody agreed on what to remove.',
    task: 'I needed an objective basis for trimming scope.',
    action: 'I pulled usage analytics, found features used by under one percent of users, and presented the data.',
    result_text: 'We removed four features and the codebase and UI got noticeably simpler.'
  },
  {
    title: 'Delivered a client demo in 48 hours',
    situation: 'Sales promised a custom demo to a major prospect with only two days notice.',
    task: 'I had to build something credible on an impossible timeline.',
    action: 'I scoped the smallest convincing slice, reused existing components, and worked focused sprints.',
    result_text: 'The demo landed and the prospect signed the following week.'
  },
  {
    title: 'Made the dashboard load ten times faster',
    situation: 'Our main dashboard took twelve seconds to load and users complained constantly.',
    task: 'I owned bringing the load time down.',
    action: 'I profiled the queries, added caching and indexes, and lazy-loaded the heavy charts.',
    result_text: 'Load time dropped to just over a second and complaints stopped.'
  },
  {
    title: 'Turned around an angry enterprise customer',
    situation: 'A large customer was ready to churn after a string of bugs hurt their trust.',
    task: 'I wanted to rebuild the relationship, not just close tickets.',
    action: 'I listened to their frustrations, gave a candid timeline, and personally followed each fix through.',
    result_text: 'They renewed their contract and became a reference account.'
  },
  {
    title: 'Organized the team offsite',
    situation: 'The team was remote and rarely connected outside of work tasks.',
    task: 'I planned a two-day offsite to build rapport.',
    action: 'I booked the venue, built an agenda mixing planning and social time, and handled logistics.',
    result_text: 'People left more connected and cross-team pings went up afterward.'
  },
  {
    title: 'Wrote the public API documentation',
    situation: 'Our API had grown but the docs were sparse and out of date.',
    task: 'I took on a full documentation pass.',
    action: 'I wrote reference pages, added runnable examples, and set up a lint check for drift.',
    result_text: 'Support questions about the API dropped and adoption rose.'
  },
  {
    title: 'Migrated the database to Postgres',
    situation: 'We had outgrown our old datastore and hit scaling limits.',
    task: 'I led the migration to Postgres with zero data loss.',
    action: 'I wrote a dual-write shim, backfilled historical rows, and cut over during a low-traffic window.',
    result_text: 'The migration finished cleanly with no downtime.'
  },
  {
    title: 'Set up the CI/CD pipeline',
    situation: 'Deploys were manual, slow, and error-prone.',
    task: 'I wanted automated, repeatable releases.',
    action: 'I built a pipeline with tests, staged rollouts, and one-click rollback.',
    result_text: 'Release frequency doubled and failed deploys became rare.'
  },
  {
    title: 'Ran the weekly engineering standup',
    situation: 'Our standups were long, unfocused, and people tuned out.',
    task: 'I took over facilitating to make them useful.',
    action: 'I tightened the format to blockers-only and moved status to a written thread.',
    result_text: 'Standups got shorter and people actually paid attention.'
  },
  {
    title: 'Built an internal analytics dashboard',
    situation: 'Teams kept asking data questions that took days to answer by hand.',
    task: 'I built a self-serve analytics dashboard.',
    action: 'I modeled the key metrics, wired up charts, and let teams filter by segment.',
    result_text: 'Teams answered their own questions and analyst load dropped.'
  },
  {
    title: 'Refactored the authentication module',
    situation: 'Our auth code was tangled and a frequent source of bugs.',
    task: 'I wanted to make it safe to change.',
    action: 'I isolated the logic behind a clean interface and added a thorough test suite.',
    result_text: 'Auth bugs fell sharply and new sign-in methods became easy to add.'
  },
  {
    title: 'Presented at an industry conference',
    situation: 'I had built something novel and was invited to present it publicly.',
    task: 'I wanted to give a talk that taught something real.',
    action: 'I distilled the work into a clear narrative and rehearsed until it flowed.',
    result_text: 'The talk was well received and brought inbound interest to the team.'
  },
  {
    title: 'Onboarded a new payments vendor',
    situation: 'We needed a second payments provider for redundancy.',
    task: 'I owned integrating the new vendor end to end.',
    action: 'I built the integration behind a feature flag and reconciled edge cases in test.',
    result_text: 'We went live with a fallback provider and reduced payment failures.'
  },
  {
    title: 'Reduced our cloud costs',
    situation: 'Our cloud bill had crept up and finance flagged it.',
    task: 'I set out to cut spend without hurting reliability.',
    action: 'I right-sized instances, removed idle resources, and added budget alerts.',
    result_text: 'We cut the monthly bill by nearly a third with no incidents.'
  }
]

export const EVAL_QUERIES: { query: string; expectTitle: string }[] = [
  { query: 'a time I led a team under pressure', expectTitle: 'Shipped the launch after the tech lead quit' },
  { query: 'handled ambiguity with no clear direction', expectTitle: 'Defined a roadmap from a vague mandate' },
  { query: 'resolved a conflict between coworkers', expectTitle: 'Mediated a standoff between design and engineering' },
  { query: 'influenced a decision without authority', expectTitle: 'Convinced leadership to adopt a new framework' },
  { query: 'learned from a mistake I made', expectTitle: 'Owned a production outage I caused' },
  { query: 'mentored or coached a junior colleague', expectTitle: 'Brought a struggling intern up to speed' },
  { query: 'used data to drive a decision', expectTitle: 'Cut features using usage analytics' },
  { query: 'delivered under a very tight deadline', expectTitle: 'Delivered a client demo in 48 hours' },
  { query: 'improved performance of a slow system', expectTitle: 'Made the dashboard load ten times faster' },
  { query: 'showed empathy for an unhappy customer', expectTitle: 'Turned around an angry enterprise customer' }
]
