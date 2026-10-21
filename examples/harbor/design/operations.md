# Harbor / Facility operations

Maintenance changes affect both the instrument calendar and the researchers who already rely on it.

## DD-004 — Reviewed maintenance blocks

Status: Proposed

Represent maintenance as a calendar block with a draft and a published state. Before publication, calculate affected reservations and ask the coordinator to record a resolution for each. Recheck for newly created reservations in the publishing transaction.

This implements the review boundary described by REQ-005. Publish cancellation events through the notification outbox to preserve the communication behavior in REQ-004.

**Trade-off.** A draft does not reserve the interval. The publication check may require another review if a researcher books during the coordinator's session.

**Review question.** Should urgent maintenance allow immediate publication with affected reservations placed in a separate resolution queue? The campus pilot currently requires review first.
