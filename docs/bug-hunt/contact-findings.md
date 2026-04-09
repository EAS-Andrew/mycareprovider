# C8 Contact Messaging & Rate Limits - Bug Hunt Findings

Auditor: contact-auditor (phase1a-bug-hunt team)
Scope: migration `0008_contact_messaging.sql`, `lib/contact/`, `lib/notify/`,
`app/(receiver)/receiver/contacts/**`, `app/(provider)/provider/contacts/**`,
and `app/api/**` as it relates to C8. Cross-referenced against the C8 section
of `docs/pid.md` (line 399 onward) and the abuse-control requirements on
line 403.

Severity legend: CRITICAL (launch-blocking), HIGH (must fix before GA),
MEDIUM (should fix soon), LOW (polish / hardening).

---

## CRITICAL

### C-1. Contact-request rate limit is not implemented (launch-blocking per PID)

`docs/pid.md:403` mandates: "per-receiver rolling rate limit on contact-request
creation (for example, N per hour per account and M per IP) ... Abuse controls
are a launch-blocking requirement for C8, not a Phase 3 hardening item."

Reality: `lib/contact/actions.ts:289` contains an unimplemented TODO:

```
// TODO(c8-rate-limit): bump `contact_request.create` via a `public.*`
// wrapper once it exists. `app.bump_rate_limit` is not reachable from
// PostgREST today because the `app` schema is not in db.schemas.
```

`sendContactRequest` inserts directly into `contact_requests` with zero
throttle. A signed-in receiver can create unlimited contact requests. There
is no trigger on `contact_requests` that calls `app.bump_rate_limit` either,
so the bypass goes all the way to the DB. This is a straight violation of
the launch-blocking C8 abuse-control requirement.

### C-2. Meeting-proposal rate limit is not implemented

Same root cause as C-1. `lib/contact/actions.ts:484`:

```
// TODO(c8-rate-limit): bump `meeting_proposal.create` once a public
// wrapper for `app.bump_rate_limit` is available.
```

No trigger on `meeting_proposals` to back-stop it either. A party to an
accepted contact request can flood `meeting_proposals` rows with no upper
bound. The PID doesn't call this one out as explicitly as contact-request
creation, but per-endpoint abuse controls are the C8 bar.

### C-3. No Vercel BotID gate on the contact-request surface (launch-blocking per PID)

`docs/pid.md:403`: "Vercel BotID on the unauthenticated contact-request
endpoint".

Reality:
- `sendContactRequest` is a Server Action (`"use server"` in
  `lib/contact/actions.ts`) called from `app/(receiver)/receiver/contacts/new/page.tsx`.
  No `checkBotId()` call anywhere in that path.
- The only BotID invocation in the entire repo is
  `app/api/providers/search/route.ts:37-48`, which fronts the C7a directory
  search, not C8.
- There is no `app/api/contact/**` route handler; the form submits straight
  to the Server Action.

Also note the PID explicitly describes this as an "unauthenticated contact-
request endpoint" but the current implementation requires sign-in first
(`loadCaller` throws `sign_in_required`). Even with the stricter auth-gate,
BotID is still a PID-mandated launch gate and is absent. This blocks the
PID C8 exit criteria.

### C-4. No per-IP dimension in rate limiting

`docs/pid.md:403` says "per-receiver + per-IP" (the example is "N per hour
per account and M per IP"). The schema's `rate_limit_buckets` keys only on
`(profile_id, scope_key, window_start)` - there is no IP column and
`app.bump_rate_limit` only reads `app.current_profile_id()`. Middleware
(`proxy.ts`) does not apply any per-IP bucketing either.

Consequences:
- A single attacker rotating cheap accounts from one IP bypasses the
  per-profile limit entirely.
- The PID explicitly lists per-IP as a launch-blocking C8 control, so this
  is a spec gap.

### C-5. Cross-party email notifications silently never send (functional regression)

All C8 transactional emails go through `lookupEmail(supabase, otherPartyId)`
in `lib/contact/actions.ts:239-253`, which reads `profiles.email` through the
caller's user-scoped Supabase client.

The RLS policies on `public.profiles` (migration 0001, lines 279-301) are:
- `profiles_public_directory` - visible rows are limited to role in
  (`provider`, `provider_company`).
- `profiles_self_select` - only the caller's own row.
- `profiles_admin_select` - admin only.

So the lookup succeeds only when the *target* profile is itself a provider.
That breaks three of the four C8 notification flows:

| Sender side | Recipient side         | email lookup works? |
|-------------|-----------------------|---------------------|
| receiver    | provider              | YES (public row)    |
| provider    | receiver              | NO (self-only RLS)  |
| provider    | receiver (meeting)    | NO                  |
| receiver    | provider (meeting)    | YES                 |

Effect: the provider's accept/decline email to the receiver
(`respondToContactRequest -> contactResponseToReceiver`,
`lib/contact/actions.ts:425-436`), the meeting-proposed email when the
proposer is the provider (`proposeMeeting`), and the meeting-response email
when the responder is the provider (`respondToMeeting`) all return `null`
from `lookupEmail`, then `sendEmail({ to: "" })` hits
`lib/notify/email.ts:121-127` and silently swallows the empty `to`. No email
is ever sent to receivers.

The PID C8 exit criterion (`docs/pid.md:270`) is "a receiver can ... send a
contact request that the provider can reply to *via email*." The reply-via-
email half of that sentence is not functional. This should be treated as a
launch-blocking bug for Phase 1a MVP, even though the UX does not throw.

### C-6. Thread-post rate limit is global per user, not per-thread (PID gap)

`docs/pid.md:403`: "per-thread rate limit on thread posts".

Implementation: the trigger in migration 0008 lines 560-569 calls
`app.bump_rate_limit('thread_post.create', 60, 30)` with a fixed scope
string. The scope does not include `thread_id`, so a single user's 30-per-
minute budget is shared across every thread they are party to. A user with
10 active conversations cannot post 30/min in each - they share one bucket.
Conversely, a single hostile thread can be flooded without any higher-level
per-thread cap.

Rewrite the trigger to build a scope like `'thread_post.create:' ||
NEW.thread_id::text` (or add a dedicated thread-scoped bucket) to match the
spec.

---

## HIGH

### H-1. Guard trigger does not protect `deleted_at` against the counter-party

`tg_contact_requests_guard` (migration 0008 lines 85-131) only rejects
changes to `receiver_id`, `provider_id`, `subject`, `body`, and illegal
`status` transitions. It explicitly allows non-status UPDATEs to pass
through: "No status change: allow (e.g. soft-delete by owner)."

But the `contact_requests_party_update` RLS policy (lines 211-221) lets
*either* party UPDATE the row. Combined with no guard on `deleted_at`, a
provider can soft-delete an incoming *pending* request from a receiver - the
receiver's SELECT policy filters `deleted_at is null`, so from the receiver
side the request vanishes without the provider ever having to accept or
decline. That is a silent way for a provider to ghost a receiver while
bypassing the audit trail (`contact_request.withdraw` / `respond` events are
never emitted).

Fix: in the guard, require that only the *owning receiver* may move
`deleted_at` from null to non-null (soft-delete is the withdraw path), or
forbid non-status, non-response_note changes entirely outside the admin
branch.

### H-2. `rate_limit_buckets` has no retention / cleanup

Migration 0008 lines 468-482 create `rate_limit_buckets` with a partial
index on `window_start` and a header comment (line 44) hand-waving "a later
vacuum job delete old windows." There is no cron, no Supabase Edge Function,
no migration that schedules cleanup, and no DELETE path. The table is
append-only and will grow monotonically with every authenticated write that
hits a rate-limit-bumped trigger.

At 30 posts/minute/user this is modest, but once C-1/C-2 above are fixed and
every contact-request/meeting-proposal create also bumps the bucket, the
growth rate becomes large enough to notice. Needs a concrete retention
mechanism before launch - at minimum a scheduled DELETE of rows where
`window_start < now() - interval '1 day'`.

### H-3. Thread-post rate-limit trigger bumps before RLS check (DoS of own bucket)

The `BEFORE INSERT` trigger `tg_contact_thread_posts_rate_limit` (migration
0008 lines 560-574) runs before the RLS `WITH CHECK` on
`contact_thread_posts_party_insert`. Postgres evaluates BEFORE-row triggers
first, then the policy WITH CHECK for the final NEW row. So any caller
attempting to post to an arbitrary `thread_id` (or to a thread where the
underlying contact_request is not `accepted`) still consumes a slot in their
own bucket before the RLS check denies the row.

A hostile client that is signed in and knows or guesses thread IDs can burn
its own 30/minute budget within a second (curl loop) and then deny itself
legitimate posting, without the posts ever landing. Low impact (they only
DoS themselves), but the rate-limiter should debit only on successful
inserts. Two fixes: move the bump into the Server Action path after RLS
success, or use an AFTER INSERT trigger (the semantics still work because
the bucket update is non-rejecting).

### H-4. Provider inbox shows `receiver_display_name: null` for every row

`queries.ts:107-145` (`listIncomingContactRequests`) joins `profiles!receiver_id(display_name)`.
Receivers have `role = 'receiver'`, so the only profile-row RLS policy that
could match is `profiles_self_select` - which never matches a cross-user
read. Result: the nested `receiver` is always `null`, and the provider's
contact inbox page cannot render a sender name. Same root cause as C-5.

This breaks a core provider UX element. Either:
- Add a narrow cross-user SELECT policy for (id, display_name) when the
  caller is a party to an existing contact_request, or
- Pivot the join through a `security definer` view/RPC that returns display
  names for parties only.

### H-5. `recordAuditEvent` runs on the user-scoped client *after* the mutation

`sendContactRequest` (lib/contact/actions.ts:293-325) inserts the row, *then*
calls `recordAuditEvent`. `recordAuditEvent` (per the C2 audit log design)
writes to `public.audit_log` through the caller's Supabase client. If that
insert is rejected by RLS for any reason (e.g. a bug in the audit policy or
a column shape mismatch), the action throws after the contact request row
has already been persisted. The user sees a `db_error` in the UI and retries,
producing a duplicate contact request. Same pattern in `withdrawContactRequest`,
`respondToContactRequest`, `proposeMeeting`, `respondToMeeting`, `postToThread`.

Either wrap the audit write in a try/catch that logs and swallows (audit
best-effort), or move both writes into a single server-side RPC so the
business row and the audit row commit atomically.

### H-6. `provider_company` role cannot actually respond to contact requests

`respondToContactRequest` (`lib/contact/actions.ts:394-395`) does
`assertRoleIn(caller.role, ["provider", "provider_company"])`, but
`contact_requests.provider_id` references `provider_profiles(id)`, which
itself references `profiles(id)` one-to-one on the individual provider's
profile row. A `provider_company` caller's profile id will never equal a
`provider_profiles.id` that belongs to an individual provider underneath
that company, so the DB guard rejects the update with
`42501 illegal contact_requests status transition`. The TS role allow-list
is lying to the UI. Either drop `provider_company` from the allow-list, or
implement `app.is_company_member()` (currently a `false` stub per
`0001_profiles_and_roles.sql:215-216`) and teach the guard about company
membership. Today, company accounts get a confusing dead-end.

---

## MEDIUM

### M-1. `meeting_at` minimum lead time is only enforced in TypeScript

`lib/contact/actions.ts:465-470` rejects `meeting_at < now() + 1h`, but the
DB trigger `tg_meeting_proposals_future_only` (migration 0008 lines 254-270)
only rejects `<= now()`. A direct HTTP insert (bypassing the Server Action)
can schedule a meeting 1 second in the future. Not a security issue, but the
guard is the only trustworthy floor - promote the 1h constant into SQL.

### M-2. `tg_contact_requests_open_thread` only fires on UPDATE

The trigger (migration 0008 lines 140-155, wired at 425-428) is `AFTER
UPDATE` only. If an admin ever `INSERTs` a `contact_requests` row directly
with `status = 'accepted'` (reasonable admin-path seeding or data repair),
no thread is created, and the receiver/provider can never post into the
bridge. The pgTAP fixture in `contact_thread_posts.test.sql` lines 30-33
already works around this by inserting the thread manually, which is a
smell.

Add an `AFTER INSERT` arm, or enforce `status = 'pending'` on INSERT via the
existing guard.

### M-3. `optionalFormString` does not trim whitespace for `location_detail`

`lib/contact/actions.ts:72-78` + the call site at 446 accept a
whitespace-only `location_detail` (e.g. `" "` ) as a valid string, which
then propagates into `meeting_proposals.location_detail`. The `Input` has
`maxLength={240}` but no trim. Minor data-quality issue.

### M-4. `profiles.email` exposure on provider role

Per H-4's root-cause trace: because the `profiles_public_directory` policy
reveals ALL columns of provider/provider_company rows (the `grant select` on
authenticated is table-wide, not column-narrowed), a signed-in user can
read any provider's email address via `select email from profiles where
id = <uuid>`. This is probably OK for a publishable-marketplace schema but
is worth an explicit decision - the `anon` role's grant is column-narrowed
to `(id, role, display_name)`, suggesting email was meant to be non-public.
Either narrow the `authenticated` grant to the same columns and add a
dedicated `profiles_self_email_select` policy, or document that provider
emails are public on purpose.

### M-5. Audit event logs `subject` which may be PII-adjacent

`lib/contact/actions.ts:320` stores the raw `subject` in the audit event's
`after` payload. The comment argues the subject is "metadata the provider
will see anyway", but users routinely put identifying details in subjects
(e.g. "Care for my mother Jane Smith"). Audit log retention is indefinite;
the `body` is correctly redacted, but `subject` should probably follow the
same rule. Worth a data-protection review.

---

## LOW

### L-1. `respondToContactRequest` does not read `caller.email` for audit context

Not a bug per se, but `recordAuditEvent` presumably derives actor info from
session context. If it doesn't, the actions pass no actor-email field and
admins tracing activity need to cross-reference by profile id.

### L-2. `runBotCheck` in `app/api/providers/search/route.ts` swallows BotID import errors

The search route's BotID gate swallows *all* errors from `botid/server` and
returns `isBot: false`. If BotID is provisioned but misconfigured in
production (e.g. missing env var), the gate silently disengages. This is
scoped to C7a, not C8, but the same pattern will be copied into the C8
BotID fix (see C-3) - worth deciding now whether a BotID outage should
fail-open or fail-closed.

### L-3. `isRateLimited` code match is fragile

`lib/contact/actions.ts:182-193` matches on `error.code === 'P0001' &&
message.includes('rate_limited')`. If any future P0001 message happens to
contain the substring `rate_limited`, it will masquerade as a rate-limit
error. Use a distinct SQLSTATE or a dedicated exception prefix.

### L-4. `formatMeetingAt` in templates emits `toUTCString()` - not user-friendly

`lib/notify/templates.ts:33` serialises meeting times in UTC. Receivers in
Europe/London will see UTC with no timezone offset guidance. Purely UX, but
the email is the canonical record of a scheduled meeting and should quote a
human-friendly local time - or at least include both.

---

## What I did NOT verify

- Whether `recordAuditEvent`'s actual RLS / implementation path would reject
  the audit writes in practice. H-5 assumes it could; verifying requires
  reading `lib/audit/record-audit-event.ts` which was outside the C8 scope.
- End-to-end runtime behaviour - this is a static audit, not a reproduction.
- `proxy.ts` coverage: I confirmed no per-IP rate limit lives there, but did
  not exhaustively audit other middleware gates.
- Any C9-era migration that may already plan to retire the bridge.

---

---

# Second pass - targeted checklist follow-up

Re-run against the explicit checklist in the task brief: (1) BotID, (2)
rate_limit_buckets race / clock-skew, (3) contact_thread_posts RLS non-
participant, (4) meeting_proposal double-accept, (5) template injection,
(6) email fan-out dropping audit rows, (7) N+1 / unbounded listings.
Items (1) and (6) were already covered above (C-3 and H-5). The rest:

## CRITICAL (second pass)

### C-7. CRLF header injection via `subject` / `display_name` in outbound email

`lib/notify/templates.ts:53` builds the email subject as:

```ts
subject: `New contact request: ${params.subject}`
```

`params.subject` comes from the receiver's form data, validated in
`lib/contact/actions.ts:258-261` only for length (3-120) and trimmed once.
There is no CRLF / control-character stripping. An attacker who submits a
subject containing `\r\n` - e.g. `"Legit request\r\nBcc: attacker@evil"` -
injects SMTP headers directly into the outgoing email subject line.

Same vector in:
- `meetingProposedTo` via `proposerName` (sourced from `caller.displayName`
  in `actions.ts:534`), which is free-form user input saved in
  `profiles.display_name` during signup via `raw_user_meta_data`.
- `contactResponseToReceiver` via `providerName` / `note`.
- `meetingResponseTo` via `note`.

Resend's API layer *may* sanitise this on their side, but we cannot rely
on that contractually and the templates hand the string in as a pre-built
subject field to `client.emails.send({ subject })` at
`lib/notify/email.ts:143`. If Resend passes it through as an SMTP header
(the standard behaviour) the injection is live.

Additional impact: a `\n\n` in subject can truncate the header and promote
the rest of the subject into body content, or inject `Bcc:` / `Reply-To:`
headers to exfiltrate mail flows.

Fix: at the boundary (form validation and/or the template layer), strip or
reject all `\r`, `\n`, and other control characters from any field that
appears in an email header. Length checks are not sufficient.

## HIGH (second pass)

### H-7. Listing queries are unbounded (`listIncoming/OutgoingContactRequests` and thread posts)

`lib/contact/queries.ts:118-145` and `lib/contact/queries.ts:164-191` both
run `.order("created_at", { ascending: false })` with no `.range()` or
`.limit()`. The provider's `/provider/contacts` and the receiver's
`/receiver/contacts` pages render the full result set server-side.

A verified provider with thousands of historical contact requests will:
- Stream the entire table through the Server Component render path on every
  navigation (no per-page SSR cache key scoping on volume).
- Pay the RLS cost for every row on every page load.
- Blow past Fluid Compute memory on extreme cases (e.g. a popular provider
  company aggregated under a single profile id in future C3b work).

Same issue in `getContactRequestWithThread` at `lib/contact/queries.ts:279-289`:
`contact_thread_posts` is fetched with no limit and no pagination. A thread
with 10k posts will load them all into memory to render the detail page. The
DB has the helpful index `contact_thread_posts_thread_idx` on `(thread_id,
created_at)` but nothing consumes it with a `LIMIT`.

Fix: paginate all three queries. At minimum cap at 100 rows per page and
render a "Load more" / cursor control for older entries.

### H-8. Multiple meeting proposals can be simultaneously accepted on one contact request

`meeting_proposals` has no uniqueness constraint or "one accepted proposal
per contact_request" rule. `tg_meeting_proposals_guard` (migration 0008
lines 274-329) only prevents *the same proposal* from being re-transitioned
out of a terminal state ("status is terminal once it leaves proposed"), but
says nothing about sibling proposals under the same `contact_request_id`.

Flow:
1. Provider proposes meeting A at 10:00 on day X.
2. Before either party accepts, provider proposes a second meeting B at
   11:00 on day X.
3. Receiver accepts A.
4. Provider also accepts B (both the counter-party check and the "old.status
   = 'proposed'" check pass because B is still `proposed`).

Result: two `accepted` rows under the same `contact_request_id`, with
overlapping / conflicting schedules. The UI in
`app/(receiver)/receiver/contacts/[id]/page.tsx:220-231` renders every
proposal in a list with independent Accept/Decline buttons, so the race is
plausible. This is a state-machine bug rather than a security hole, but the
C8 exit criterion is "a provider can reply via email" and "schedule an
initial meeting" - double-accept corrupts the latter.

Fix: add a partial unique index
`create unique index meeting_proposals_one_accepted_idx on meeting_proposals (contact_request_id) where status = 'accepted' and deleted_at is null`
and return a friendly error on conflict.

## MEDIUM (second pass)

### M-6. Rate-limit window is tumbling, not sliding (burst-at-boundary)

`app.bump_rate_limit` (migration 0008 lines 511-516) aligns `v_window_start`
to a deterministic integer boundary:

```sql
v_window_start := to_timestamp(
  floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
);
```

This is a tumbling window. A user can do 30 posts at 00:00:59 and another
30 at 00:01:00 - 60 posts inside two seconds - and each one lands in a
different bucket that's individually within the 30/minute cap. The effective
per-minute limit across the boundary is thus 2x the nominal cap.

Also: the lock key uses `hashtext(profile || '|' || scope)` which is
Postgres' 32-bit non-cryptographic hash. Two distinct `(profile, scope)`
pairs that collide on the 32-bit hash would serialise on the same advisory
lock (correctness-safe but a cross-user contention risk at scale - e.g. a
single busy user can slow down another unrelated user whose hash collides).

Fix: switch to a sliding-window algorithm (two overlapping buckets, or a
rolling counter). Use a 64-bit hash or a proper lock key derivation.

### M-7. Clock-skew window assumption is safe but needs an integer-overflow audit

`floor(extract(epoch from now()) / p_window_seconds)` works with `double
precision` epochs. `p_window_seconds` is `int`. A caller passing a very
small window (e.g. 1) and `now()` late in the century produces a huge
quotient that still fits in double, so no overflow risk in practice. Noting
this because it's the kind of thing a later codepath might trip on: if a
future scope uses `p_window_seconds = 0` - the `check (window_seconds > 0)`
in the table prevents the stored value from being zero, but `p_window_seconds`
is the *parameter*, not a stored value, and a zero parameter would divide
by zero. Add a parameter guard in the function body.

### M-8. contact_thread_posts read policy does not require `status = 'accepted'`

`contact_thread_posts_party_read` (migration 0008 lines 582-597) walks
`contact_threads -> contact_requests` and checks party membership, but does
NOT filter on `cr.status = 'accepted'`. The insert policy (lines 599-616)
correctly filters on status, but read does not. Consequence: if a
`contact_request` is later moved out of `accepted` (e.g. admin sets it to
`declined` or soft-deletes), the thread and its posts remain readable by
the parties. The schema guard triggers prevent `accepted -> X` transitions
for non-admins, so the window is admin-only today, but the read policy is
still technically broader than the PID intent and will surprise whoever
wires admin moderation in C9.

---

## Summary (second pass merged)

| Severity | Count |
|----------|-------|
| CRITICAL | 7     |
| HIGH     | 8     |
| MEDIUM   | 8     |
| LOW      | 4     |

The launch-blockers cluster in two areas: (1) the C8 abuse-control suite
(BotID, per-receiver + per-IP rate limits on contact-request and meeting-
proposal creation) is essentially not implemented - the code contains TODOs
where the PID requires working gates, and (2) cross-party email notifications
silently no-op because the user-scoped Supabase client cannot read the other
party's profile.email under RLS. Both are a direct miss against the PID C8
exit criteria on `docs/pid.md:270` and `docs/pid.md:403`.
