# Harbor / Delivery tasks

Iteration 3 · Reservation reliability

Work is organized around reviewable changes with concrete completion criteria. These are illustrative authored task states.

## TASK-001 — Add reservation constraints

Status: In progress

Implement the transaction and interval constraint in DD-001. Persist the idempotency key and original response together with the reservation.

**Completion criterion.** Concurrent requests cannot create overlapping active reservations, and a retried request returns the original reference.

## TASK-002 — Exercise concurrent requests

Status: Ready

Add integration scenarios for DD-001 using separate database connections. Include identical intervals, partial overlap, adjacent bookings, and a client retry after a successful commit.

**Completion criterion.** Each race has one predictable outcome and leaves no orphaned idempotency record.

## TASK-003 — Evaluate training validity

Status: In progress

Implement the policy gate in DD-002, including the qualification version captured with the booking. Return a structured reason for missing or expired training.

**Completion criterion.** Boundary cases cover qualification expiry at the booking start, during the interval, and exactly at its end.

## TASK-004 — Explain eligibility failures

Status: Ready

Use the rejection codes from DD-002 to display a concise explanation beside the selected instrument. Preserve the requested interval while the researcher checks their training record.

**Completion criterion.** The error is keyboard accessible and names the required qualification without disclosing private training history.

## TASK-005 — Deliver outbox messages

Status: Ready

Implement the mail worker described in DD-003. Add retry scheduling, event deduplication, and an operations view of exhausted events.

**Completion criterion.** A simulated mail outage leaves the reservation confirmed; recovery delivers one logical notification per event.

## TASK-006 — Prototype maintenance review

Status: Planned

Build a coordinator walkthrough for DD-004 with affected reservations and explicit resolution choices. Include a new booking arriving between preview and publication.

**Completion criterion.** Facility coordinators can explain which reservations are affected before publishing a maintenance block.


## some dates

- 2026-10-13: Started reservation constraints for TASK-001.
- 2026-10-14: Reviewed the concurrency approach in DD-001.
- 2026-10-15: Planned concurrent request tests for TASK-002.