---
name: feedback-map-and-release
description: Hard lessons from v5.3.x — dashboard map projection rules and release process mistakes to avoid
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
---

## Rule 1: Never change the dashboard map's internal coordinate system

The world map continent paths are pre-computed in `main.js` (`get-world-map` handler) using hardcoded `W=720, H=340`. They are stored as pixel-coordinate SVG path strings and cached in `_worldPaths`. The dot positions in `renderDashMap()` in `index.html` are also computed with `W=720, H=340`.

**If you change `H` in index.html, or change the `viewBox` to a different coordinate space, the dots and continent paths will desync.**

**Why:** The paths from main.js are always fixed to H=340. The dots recalculate at runtime using whatever H you set. Any mismatch = dots landing in the ocean or wrong country.

**How to apply:** To make the map shorter, use ONLY CSS — keep `viewBox="0 0 720 340"` and `H=340` unchanged. The correct approach is:
```html
<svg id="dash-map" viewBox="0 0 720 340" width="100%" height="300"
     preserveAspectRatio="xMidYMin slice" style="display:block"></svg>
```
`height="300"` constrains display height. `xMidYMin slice` fills the container from the top, cropping the Southern Hemisphere ocean off the bottom. Dots stay perfectly aligned with continents.

---

## Rule 2: Multiple commits under the same version number won't auto-update

**Why:** The auto-updater compares installed version string vs GitHub Release version string. If you fix a bug and push 3 commits but all carry version `5.3.0`, and the GitHub Release was already published as `5.3.0` from the first commit, subsequent `release.bat` runs will fail silently (tag already exists). The installed app never sees a newer version.

**How to apply:** If you publish a broken release and push fixes, bump the patch version (e.g., `5.3.0` → `5.3.1`) before the next `release.bat` run. Always bump the version when a new release needs to reach users.

---

## Rule 3: Always tell Dean to run release.bat → update the installed .exe (NOT start.bat, NOT update.bat)

**Why:** Dean's actual workflow is: run `release.bat` (builds installer + publishes GitHub Release), then update/open the installed `.exe`. He does NOT run `start.bat` (dev launch) or `update.bat` (dev pull). Telling him `start.bat` is confusing and wrong — it kept happening across rounds (2026-06-27) and he called it out explicitly.

**How to apply:** Every round-up's "how to check" step is: **"Run `release.bat`, then update/open the app (.exe)."** Never `start.bat`, never `update.bat`.

---

## Rule 4: Round-up presentation format Dean wants (every change round)

**Why:** Dean asked (2026-06-27) for a consistent structure so each update is easy to act on.

**How to apply:** Present every change round in this exact order:
1. **What changed** — the summary (this part has been fine).
2. **Steps to check** — the action: run `release.bat`, then update/open the app exe.
3. **What to check for** — what to look at/verify in the app.
4. **Still owed** — only if applicable (pending follow-ups).
5. **Closing line(s)** — the "once you confirm X, we'll do Y / move on" wrap.
