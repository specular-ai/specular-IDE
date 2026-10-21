# Harbor

## Shared equipment, dependable reservations

Harbor helps university research teams reserve shared instruments without overlapping bookings or last-minute surprises. Researchers find an available slot; facility coordinators manage access, maintenance, and cancellations.

The first release serves one research campus with 40 instruments across three facilities. Researchers sign in with their institutional account. Each instrument has an owner, an availability calendar, and an optional training requirement.

### A typical reservation

1. A researcher selects an instrument and an available time slot.
2. Harbor checks training eligibility and confirms that the slot is still free.
3. The reservation is recorded and a confirmation is queued.
4. The researcher can cancel; the released slot becomes available immediately.

### Release scope

| Area | First release |
| --- | --- |
| Reservations | Availability, conflict prevention, cancellation |
| Access | Institutional identity and instrument training |
| Communications | Confirmation and cancellation email |
| Operations | Maintenance windows and an audit history |

### Reading the specification

- [Requirements](requirements.md) describe observable behavior and acceptance examples.
- [Reservation design](design/reservations.md) records concurrency, eligibility, and notification decisions.
- [Operations design](design/operations.md) describes maintenance handling.
- [Delivery tasks](delivery/tasks.md) connect planned work to those decisions.

This is a fictional demonstration specification. Statuses describe its illustrative review and delivery state; no implementation or deployment is claimed.
