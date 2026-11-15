---
name: abrp-declutter-catalog
description: "Running catalog of ABRP areas Dean finds unused/cluttered — collect only, NO action until he asks for the full debrief"
metadata:
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-11-15T02:54:33.606Z
---

Dean 2026-11-14: he keeps finding ABRP areas he no longer needs or uses. He'll share screenshots over time;
I **catalog only**. Nothing gets changed until he asks for a full debrief, which then proposes one plan.

**Why:** the app grew feature by feature, and he wants one considered clean-up pass, not piecemeal removals.

**How to apply:**
- When he shares a new item, add it here (date, what he said, what I found), then confirm in one line.
- Don't build, remove or hide anything.
- At debrief time, give each item a verdict: remove / hide behind a toggle / fix / keep. Note what else
  depends on it (tests, settings, other tabs).

**Catalog**
1. **Performance tab dashboard (2026-11-14).** The aircraft cards (Fenix/PMDG/Citation…), "Hide reference",
   the Combined/By-aircraft P99 + VRAM bar charts and the TLOD filter chips are never looked at. He scrolls
   straight to the per-flight table at the bottom and opens individual flight reports. Ties to the parked
   "Performance v7 blueprint" (FLIGHTS view first) in the roadmap.
   **KEEP (Dean said "this is fine"):** the Performance toolbar row — Dashboard, Compare, Baseline,
   Settings A/B, Scenery, ↗, Arm Capture, Record Now, Stop & file, CapFrameX, Show coverage.
2. **Utilities list shows version-number rows (2026-11-14)**, e.g. 1.0.0.12, 120.0.6050.0, 73.0.0.0. Found:
   the Util folder also holds desktop apps (Nusantara Cinema, Flight Recorder, SimpleUI, FlightSimDispatch,
   GSX Profile Manager…). ABRP counts any folder holding a manifest.json as a package, and versioned
   runtime folders inside those apps (WebView2/Chromium etc.) carry one. So those rows aren't MSFS add-ons;
   they're a detection bug. Likely fix: require an MSFS-style manifest (package_version/content_type) and
   skip known runtime folders. The real utilities are aerosoft-toolbar-pushback and
   bijanstudio-bijan-seasons-enhanced.
3. **Settings → Display Resolution on Launch (2026-11-14).** The DLDSR desktop-resolution switch isn't
   needed. It's off, and there's no DLDSR resolution available. Candidate for removal.

Side observation (not a catalog item unless he says so): "✱ Fresh routes" hides any city pair among the last
30 SimBriefed flights, but the dashboard "Recent routes" lists only FLOWN flights (since v6.10.6). A planned
but never-flown pair still hides from Fresh until removed from Recent Routes. Related: [[fresh-routes-removal-timing]].
