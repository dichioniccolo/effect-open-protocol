# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-09-19 — past-limit

**Question:** When a recovery pass hits `recoveryLimit`, what happens to the rest?

**Answer:** `recoverGap` runs another pass right away while a pass reports
`skipped > 0` and made progress, until caught up. `recoveryLimit` becomes the
batch size of one pass, not a cap on recovery.

**Rationale:** Recommended. Nothing else continues a pass once a line goes
quiet. Rejected: a bigger default limit (any larger backlog still waits for a
trigger) and a default recovery timer (a 0064 per interval per device forever,
and slow to catch up). Requiring progress keeps a pass that fetches nothing
from looping.

## 2026-09-19 — window

**Question:** Should the recovery window skip IDs already delivered?

**Answer:** Yes. IDs the dedup window has seen are dropped before the limit is
applied.

**Rationale:** Recommended. Counting from the watermark lets one stuck hole
pin the window, so every pass re-reads the same block. Rejected: keeping the
current count.

## 2026-09-19 — rejections

**Question:** Which MID 0004 answers to a 0064 mean the result is gone?

**Answer:** Only code 15 ("Tightening ID requested not found"). The watermark
then moves past that ID. Any other code is pending and retried.

**Rationale:** Recommended. Code 79 ("Command failed") is transient, and the
chaos fault sends it (see RESEARCH.md, External Landscape). Writing off a
code-15 ID stops it pinning the watermark and growing `ahead`. Rejected:
keeping the hole behind a code 15, and treating every code as final (current).

## 2026-09-19 — late-reply

**Question:** What to do with a 0065 whose ID differs from the one requested?

**Answer:** Submit it as recovered, and count the requested ID as pending.

**Rationale:** Recommended. A late reply is a real stored result, so
dropping it wastes a fetch. Rejected: dropping it, and validating inside
`RequestReply` (a bigger change to a shared module for the same outcome).

## 2026-09-19 — latest-unanswered

**Question:** With a watermark set, what does a pass do when the latest-ID
lookup gets no answer?

**Answer:** Report it pending, so the pass retries.

**Rationale:** Found in the second probe run (tool-11): the pass fell back to
the watermark, found nothing to fetch, and stopped with 100-103 still pending.
No answer says nothing about what the controller holds. No alternative was
considered: the fallback was simply wrong.

## 2026-09-19 — empty-baseline

**Question:** A controller that was empty at first contact lets whichever
result is delivered first become the watermark, even a late reply (tool-36
lost 13-22 this way). How is its baseline set?

**Answer:** Floor search. Until a baseline exists, nothing moves the
watermark. Recovery walks down from the newest ID, skipping what was
delivered, `recoveryLimit` requests per pass, until the controller answers
code 15 or ID 1 is reached; that floor becomes the baseline. A pushed result
arriving before any baseline starts a pass.

**Rationale:** Recommended. It costs only requests for results the
application needs anyway. Rejected: assuming an empty controller counts from
1 (one code-15 request per ID below a counter that may be in the millions),
and deferring it as a known limit. The pass on a pushed result is needed so a
controller that never drops still gets a baseline and gap detection.

## 2026-09-19 — catch-up-pass

**Question:** How are results produced during the handshake's recovery pass
recovered?

**Answer:** One more pass runs as soon as the subscription is up, next to the
push consumer, and retries whatever the handshake pass left pending.

**Rationale:** The controller never pushes those results, and on a quiet line
no later push reveals the gap. Costs one extra latest-ID 0064 per session.
Rejected: relying on `recoveryInterval` (polling forever to cover one moment
per session).

## 2026-09-19 — exact-seen

**Question:** How does duplicate detection avoid re-delivering IDs its window
evicted?

**Answer:** `Dedup.seen` is exact past the baseline: an ID above the baseline
and up to the watermark was delivered or written off, and `ahead` holds the
IDs delivered above the watermark. Only IDs at or below the baseline rely on
the bounded window.

**Rationale:** A first version checked only `ahead`; the next 300 s run still
delivered 6 results twice, IDs below the watermark that had left the window.
Recording the baseline costs one number. A pushed resend of a pre-baseline
result still reaches the handler, as before. Rejected: a bigger window (moves
the problem, costs memory).

## 2026-09-19 — simulator-subscription

**Question:** The simulator keeps one `subscribed` flag per device, which leaks
into a new connection. Fix the simulator, or harden the client against
pushes before subscribing?

**Answer:** Fix the simulator: a new connection starts unsubscribed.

**Rationale:** A real controller does not push on a connection that has not
subscribed, so the chaos run was testing an impossible controller. The
client's head-of-line blocking on a full subscription queue is logged in
`explorations/INBOX.md` instead of fixed here.

## 2026-09-19 — atomic-resubscribe

**Question:** How is a leaked results subscription prevented?

**Answer:** Taking the subscription again and remembering it run as one
uninterruptible step.

**Rationale:** The registration was already uninterruptible, so only the
bookkeeping after it could be skipped. Making the pair atomic adds no waiting.
Rejected: tolerating `AlreadySubscribed` (the stream handle is lost, so the
existing registration could not be consumed anyway).

## 2026-09-19 — defect-backoff

**Question:** What does the supervisor do after a defect?

**Answer:** It logs the defect, turns it into a lost session, and goes through
`Failed` and the reconnect backoff like any other failure.

**Rationale:** Restarting at once repeats the defect from a state where a new
attempt is invalid: a hot loop that starves every other device. Rejected:
stopping the device (one bug would silently take a line offline for good).

## 2026-09-19 — stop-on-silence

**Question:** How long may one pass keep asking a link that does not answer?

**Answer:** It stops after 3 requests in a row get no answer at all, and
reports the rest pending. A refusal or a reply for another ID still counts as
an answer.

**Rationale:** Waiting out every timeout held a pass for up to 100 s, and a
handshake pass for minutes. Rejected: a shorter `recoveryTimeout` (a slow but
working link would then fail every request).

## 2026-09-19 — keep-up

**Question:** Who retries what a pass had to give up on?

**Answer:** `GapRecovery.keepUp`, running for as long as the session is up:
while the last pass left IDs pending or beyond the limit, it runs another
pass every `recoveryRetryDelay`. When caught up it sends nothing.

**Rationale:** Makes "the pass repeats while the session lives" true without
unbounding the handshake pass, which must still let the session subscribe.
Rejected: unbounded retries inside `recoverGap` (would hold a handshake on a
controller that never answers).

## 2026-09-19 — claimed

**Question:** How does a pass avoid fetching a result an earlier pass handed
to delivery but the handler has not taken yet?

**Answer:** `Dedup` tracks claims: delivery claims a result when it is
queued and drops the claim once it is handled, fails, or turns out a
duplicate. Recovery skips what is delivered or claimed (`known`); the
delivery loop's own duplicate check still looks only at what was delivered.

**Rationale:** Found by `TcpOutage.test.ts` failing about one run in five
(`duplicates` 1 instead of 0): the catch-up pass right after the handshake
pass fetched the missed result again while it was still queued. A failed
handler releases its claim, so that result stays fetchable. Rejected: making
recovery wait for each submitted result to be handled (ties recovery speed to
the handler's).

## 2026-09-19 — double-load

**Question:** Must the chaos run also pass with two runs sharing the CPU?

**Answer:** No. Not an acceptance criterion; the solo command is.

**Rationale:** The demo already runs the client, 50 simulated controllers and
the fault injector in one process, far heavier than production, where the
process runs only the client. What doubling the load produced was replies
handled after their timeouts, which the chaos faults inject on purpose
(delayed replies, silent links) and which the fixes handle whatever the cause.
Under load recovery is slower, not lossy; only the demo's fixed 30 s settle
window counts slow as lost.
