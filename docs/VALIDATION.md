
## Actual local HTTP and D1 validation

Date: 2026-11-14 (Asia/Taipei). Environment: Vinext dev on loopback, real local Cloudflare D1; mock ChatGPT login via the supported local sign-in route. No production records changed.

- Anonymous admin/export access and absent-Origin writes rejected.
- 150 persistent random card URLs generated; repeated generation preserved every URL.
- Published assignments remained hidden before live reveal; participant names stayed private.
- Actual D1 published group reveals only in live/open state
- Draft edits do not leak through the actual D1 publication snapshot
- Actual D1 claim, ownership, profile save and anonymous rejection
- Personal profile appears in after-event state
- Inactive NFC card returns 410, reactivation restores lookup
- 150 concurrent actual HTTP/D1 lookups: {"requests":150,"success":150,"errors":0,"wallMs":3356,"p50Ms":3210,"p95Ms":3332,"maxMs":3346}
- Offline CSV exports published group and participant records

Load measurements are local-dev observations, not a production capacity guarantee. Browser/device/network QA remains separate. The local event was restored to before/reveal-closed, with 150 local blank cards and one clearly labelled QA participant/group.

## Browser validation

- Checked the actual mobile page at 390 × 844 and profile editor at 360 × 800.
- Checked desktop administration at 1440 × 1000; no horizontal page overflow.
- Verified invitation modal, skip/close, event-information jump, team reveal, and persistent information.
- Verified local sign-in, manual group editing and successful save, and private profile editing and successful save.
- Fixed a server/browser locale spacing hydration mismatch by formatting the event date deterministically.
- Fixed the administration navigation overflow scrollbar.
- Verified all displayed hero/poster images loaded.
- Real iOS/Android NFC scans, physical card writing, venue Wi-Fi/mobile data, and a real YouTube trailer still require organizer verification. No trailer was supplied; the player is implemented and its URL validator is tested.
