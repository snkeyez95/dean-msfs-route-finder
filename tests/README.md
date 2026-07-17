# ABRP tests

Run them: **double-click `run_tests.bat`**, or `node tests\run_all.js` from the project folder.

These check the app's own logic before a change reaches a release. They don't touch your flight
logs, your settings, or anything in `%APPDATA%` — they only **read** the airport/airspace cache.

## Why they live here

They used to live in a Windows temp folder. On 2026-07-16 a disk-cleanup run deleted the lot —
about 57 files built up over weeks. They live in the project now so they're backed up to GitHub
with everything else. They're excluded from the installer (`build.files` → `!tests/**`), so they
never ship to the app.

## The suites

| File | What it protects |
|---|---|
| `test_parse.js` | Every shipped module and both HTML files still parse. Cheapest net; needs no data. |
| `test_atc_matrix.js` | ~45,000 combinations of who's online × phase of flight, over real airspace. Asserts invariants ("never recommend an offline frequency", "never say UNICOM while someone covers you", "never go backwards through the sequence") rather than hand-written answers — nobody can hand-write 45,000 right answers. |
| `test_alerts.js` | Alerts as a *sequence* of 5-second polls: no chime storms at airspace boundaries, sign-offs alert instantly, cold start is silent, handoffs fire once, every toggle respected. |
| `test_vatsim_surface.js` | Route scoring (incl. "removing a controller must never raise the score"), callsign resolution, coverage-tier semantics, the segmented-airspace merge, frequency matching, and speed. |
| `test_v6128_audit_fixes.js` | The four v6.12.8 audit fixes, locked so they can't quietly come back. |
| `test_autofps_tail.js` | The v6.12.9 fix: the overlay's live TLOD reading doesn't blink. |

## Two rules that make these worth having

**Test against real data, not mock-ups.** The suites read the actual `airspace.json` and
`airport_db.json` the app uses. The New York Center bug (v6.12.8) only existed against real VATSpy
data — synthetic polygons would have passed happily while the app was broken.

**Assert invariants, not expected answers.** For anything with a big combination space, state a rule
that must always hold and check it everywhere. That's what caught bugs a hand-written expectation
would have walked straight past.

## If a suite says SKIP

It needs `airspace.json` / `airport_db.json` in `%APPDATA%\A Better Route Planner`. Open the app
once (or Settings → refresh airspace data) and they'll download.

## History

The original ~57 suites are gone. These are the ones rebuilt after the loss; more will come back as
we touch each area. If you're adding coverage, put it here — never in a temp folder.
