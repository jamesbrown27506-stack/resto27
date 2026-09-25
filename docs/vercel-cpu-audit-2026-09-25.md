# Resto237: Vercel CPU usage audit

**Date:** 25 September 2026  
**Scope:** Read-only review of the Vercel Hobby dashboard, recent function logs, and the `resto237` repository. No application code, Supabase schedules, or Vercel settings were changed.

## Summary

Resto237 accounts for most of the team's Vercel Function CPU usage. The clearest recurring waste is the payment reconciliation endpoint being called every minute by Supabase `pg_net`, although the repository defines a ten-minute schedule. The reconciler itself is important for payment correctness; its excess frequency is the thing to remove.

| Vercel measure | Observed value | Period |
| --- | ---: | --- |
| Team Fluid Active CPU | 4h 20m against 4h included on Hobby | Last 30 days |
| Resto237 Fluid Active CPU | 3h 44m, 86.1% of team total | Last 30 days |
| Resto237 function invocations | About 386,000, 94.6% of team total | Last 30 days |
| `/api/cron/reconcile` | 764 invocations, about 1 minute of CPU | Recent 12-hour view |
| `/api/cron/order-nag` | 153 invocations, 32 seconds of CPU | Recent 12-hour view |
| Homepage `/` | 59 invocations, 17 seconds of CPU | Recent 12-hour view |

Sources: [team CPU usage](https://vercel.com/emmanuel-legrands-projects/~/usage/vercel-functions-fluid-cpu-duration?view=Projects), [team function invocations](https://vercel.com/emmanuel-legrands-projects/~/usage/vercel-functions-invocations?view=Projects), and [Resto237 function observability](https://vercel.com/emmanuel-legrands-projects/resto237/observability/vercel-functions?environment=all). Figures are dashboard snapshots from 25 September 2026 and will change.

Vercel defines Fluid Active CPU as time spent executing code, excluding time waiting on external services. The [Hobby plan includes four CPU hours](https://vercel.com/docs/functions/usage-and-pricing). A function can therefore consume CPU even when its database queries find no work.

## Confirmed scheduling mismatch

The repository's [Supabase schedule](../supabase/migrations/0045_pg_cron_schedule.sql#L103-L109) defines:

```text
resto237-reconcile  */10 * * * *  /api/cron/reconcile
```

That means approximately 72 calls in 12 hours. Vercel recorded **764** in a comparable 12-hour view, about ten times the intended rate. Recent [function logs](https://vercel.com/emmanuel-legrands-projects/resto237/logs?routes=%2Fapi%2Fcron%2Freconcile) showed successful `GET` requests at consecutive minute marks. The inspected request identified its user agent as `pg_net/0.20.4` and its host as `resto237.vercel.app`. The project's Vercel Cron Jobs settings displayed no registered Vercel jobs, so disabling Vercel Cron Jobs is unlikely to stop these requests.

The inspected reconciliation request queried `payment_attempts` twice, `refunds`, and `withdrawal_requests`, then wrote `ops_heartbeats`. Its log showed no CamerPay request. This describes **one sampled invocation**, not every run. The code makes these queue checks on each run in [`src/lib/payments/reconcile.ts`](../src/lib/payments/reconcile.ts#L66-L198), and the route stamps a heartbeat in [`src/app/api/cron/reconcile/route.ts`](../src/app/api/cron/reconcile/route.ts#L25-L33).

The request metadata proves that Supabase `pg_net` sent the inspected call. The exact live `cron.job` row was **not inspected**, so it remains to be verified whether an old one-minute job, a duplicate job, or another Supabase scheduling path is responsible.

### Why the reconciler should remain

The reconciler settles payment attempts when a customer closes the page or a payment callback is missed. It also retries incomplete settlements, reservation refunds, and payouts. Removing it can leave real money movements unresolved. Restore the intended schedule rather than removing the endpoint.

## Other CPU opportunities

1. **Reduce live page refreshes where freshness permits.** The [guest table page](../src/app/(table)/table/%5Btoken%5D/guest-table-client.tsx#L125) and [manager table floor](../src/app/(manager)/m/table-order/dining-floor.tsx#L179) refresh every five seconds while visible. These calls are useful during an active dining session, but could be restricted to active sessions or paired with a slower fallback after push updates. The [kitchen board](../src/app/(manager)/m/kitchen/kitchen-board.tsx#L26) refreshes every 15 seconds and the [manager order queue](../src/app/(manager)/m/orders/orders-queue.tsx#L23) every 30 seconds. They already pause when hidden.
2. **Pause the customer order refresh when hidden.** The [customer order detail](../src/app/(customer)/orders/%5Bid%5D/order-detail.tsx#L93) refreshes every 15 seconds until the order reaches a terminal state. Its interval does not check tab visibility, although it also refreshes when the tab becomes visible. This is a concrete avoidable request source when customers leave the tab open.
3. **Consider caching public rendering after the scheduled job is fixed.** The [root layout reads cookies](../src/app/layout.tsx#L112-L132), making public pages dynamic, and the [homepage gathers several data sets](../src/app/(public)/page.tsx#L126-L143) per render. Brief caching of suitable public data could lower CPU as traffic grows. The homepage accounted for only 17 seconds in the recent 12-hour view, so this is a later optimization, and freshness and language behavior need review before changing it.
4. **Review the proxy separately.** The [proxy](../src/proxy.ts#L53-L61) checks the Supabase session on matching requests, including public pages and cron endpoints. This contributes to edge request work, but the dashboard's **Fluid Active CPU** problem is dominated by server functions. Do not remove session verification without checking authentication behavior.

The other recent cron totals were comparatively small: delivery monitoring used 12 seconds and reservation reminders 8 seconds over 12 hours. Their schedules in migration 0045 match the approximate observed frequencies. There is no evidence that deleting mobile app files or npm dependencies would materially reduce runtime Fluid Active CPU; those files mainly affect builds and client bundles.

## Historical spike and limits of attribution

The 30-day Vercel graphs show a large spike around **21 September**: approximately 140,000 function invocations and 45 minutes of CPU in one day. QR table-service work was added that day; a [22 September commit](https://github.com/Mrcode27/resto237/commit/f6618d7007dee92c131065e64f8246a5059567c7) paused several hidden-tab polling loops. This timing suggests polling contributed, but the available historical function breakdown does not establish the exact cause. Recent observability, which does show routes, is limited to a shorter window on Hobby.

Correcting the one-minute reconciler schedule should prevent future unnecessary calls. It will **not subtract CPU already counted** in Vercel's usage window. The large historical spike means a tenfold reduction in the current reconciler frequency should not be represented as a tenfold reduction in the full 30-day total.

## Recommended order of work

1. **Read the live Supabase schedule without exposing its bearer secret.** In the Supabase SQL editor, list job names, schedules, and active flags, including any job whose command targets the reconciler. Do not select or share the `command` column because it embeds the authorization header.

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname like 'resto237-%'
      or command like '%/api/cron/reconcile%'
   order by jobname, jobid;
   ```

2. **Leave one active reconciler job at `*/10 * * * *`.** Remove or replace any extra one-minute caller only after confirming its identity. Keep the other time-sensitive jobs unless their live schedules also differ from the repository.
3. **Check Vercel logs after the schedule change.** The reconciler should appear roughly once every ten minutes. Compare daily Fluid Active CPU and invocation counts after the change, accounting for traffic.
4. **Then reduce unnecessary page polling**, starting with the hidden customer order tab and any table-service sessions that remain open after service ends.

Vercel's [Hobby Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) can run only once per day, so they cannot directly replace the five-to-fifteen-minute jobs used by this application. The repository's migration comment about a two-job Hobby limit is outdated; the once-per-day frequency limit remains the relevant restriction.
