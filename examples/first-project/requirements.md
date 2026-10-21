# Focus timer — requirements

Small enough to understand. Useful enough to build.

| ID | Requirement | Status |
| --- | --- | --- |
| REQ-001 | A user can start a 25-minute focus session with one action. | Confirmed |
| REQ-002 | A running session can be paused and resumed without losing remaining time. | Confirmed |
| REQ-003 | When time expires, show a completion message. | Confirmed |
| REQ-004 | Decide whether completion should also play a sound. | Open |

## Acceptance notes

REQ-001 starts in the idle state defined in [the design](design.md#timer-states). REQ-002 introduces the paused state. REQ-003 completes the session.

- [x] Agree on the initial duration.
- [ ] Confirm the notification behavior for REQ-004.
- [ ] Try the flow with keyboard navigation.

The implementation sketch is in [src/timer.ts](src/timer.ts).
