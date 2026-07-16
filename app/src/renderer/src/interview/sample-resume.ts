export const SAMPLE_RESUME = `Jordan Rivera
Senior Software Engineer

SUMMARY
Backend-leaning full-stack engineer with 6 years building payments and data
infrastructure. Comfortable owning a service end to end: design, ship, on-call.

EXPERIENCE

Staff Engineer — Northwind Payments (2022–present)
- Led the rewrite of the settlement pipeline from a nightly batch job to a
  streaming system on Kafka, cutting merchant payout latency from 24h to under
  5 minutes and removing a recurring class of reconciliation bugs.
- Designed an idempotency layer for the charge API after a duplicate-charge
  incident; drove it across four teams and added contract tests to enforce it.
- Mentored three engineers; ran the team's on-call rotation and incident reviews.

Senior Software Engineer — Atlas Analytics (2019–2022)
- Built the query cache that backed the customer-facing dashboards, taking p95
  load time from 3.1s to 600ms under 10x traffic growth.
- Migrated the primary Postgres database to partitioned tables with zero
  downtime, coordinating a phased cutover behind a feature flag.

Software Engineer — Bluebird Labs (2018–2019)
- Shipped the first version of the notification service (email + push) used by
  the whole product; owned deliverability and bounce handling.

SKILLS
TypeScript, Go, Python, Postgres, Kafka, Redis, AWS, distributed systems,
observability, on-call incident response.
`
