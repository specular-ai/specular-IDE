# Harbor / Product requirements

Release 0.3 · Campus pilot · Specification review

Researchers need to trust the booking calendar when several teams share an instrument. The pilot prioritizes reliable reservations, clear access rules, and timely communication.

## REQ-001 — Confirm a reservation

Status: Approved

A trained researcher can reserve an available instrument for a start and end time. Confirmation includes a reservation reference, the instrument name, and the booked interval. A slot is confirmed only after both availability and training checks succeed.

**Acceptance example.** Maya reserves the confocal microscope from 10:00 to 11:00. She receives one reservation reference. If another researcher requests the same interval concurrently, only one request succeeds; the other receives an explanation and refreshed availability.

## REQ-002 — Prevent overlapping bookings

Status: Approved

An instrument cannot have two active reservations with overlapping intervals. Adjacent reservations are allowed: a booking ending at 11:00 does not conflict with one starting at 11:00. The rule also applies when a client retries a request after a connection timeout.

**Acceptance example.** Two concurrent requests for the same instrument and interval produce one active reservation. Retrying the successful request returns its original reservation reference.

## REQ-003 — Check instrument training

Status: Approved

Instruments marked as training-required can be booked only by researchers whose qualification is valid for the entire requested interval. A rejected request explains which qualification is missing or expires too soon.

**Acceptance example.** A qualification expiring on Friday cannot authorize a Saturday booking. A coordinator can update the qualification, after which the researcher may submit a new request.

## REQ-004 — Notify reservation changes

Status: In review

Researchers receive an email after a reservation is confirmed or cancelled. Delivery failures must not undo a confirmed booking. The booking page remains the authoritative source of reservation state.

**Acceptance example.** If email delivery is unavailable for ten minutes, the reservation remains visible and its notification is retried without creating another booking.

## REQ-005 — Block maintenance windows

Status: Draft

Coordinators can mark an instrument unavailable for maintenance. New reservations intersecting that interval are rejected. Existing reservations are listed for coordinator review before the maintenance window is committed.

**Acceptance example.** A coordinator schedules a calibration from 09:00 to 12:00. Harbor identifies affected reservations and requires an explicit decision for each before publishing the window.
