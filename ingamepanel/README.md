# ABRP Live ATC — MSFS in-game toolbar panel (POC)

A thin in-sim toolbar panel that shows ABRP's live VATSIM frequency recommendation INSIDE MSFS —
including in exclusive fullscreen, on any aircraft. The panel is a dumb shell: it's just an iframe
pointing at a page ABRP serves locally (`http://localhost:8177/panel`). All UI and data live in ABRP,
so the panel package never needs updating when the UI changes.

## How it works
```
ABRP (Live mode on)
  └─ caches the recommendation every 5s (same payload as the desktop overlay)
  └─ serves it on http://127.0.0.1:8177  (GET /panel = the page · GET /latc/state = JSON)
MSFS toolbar icon → panel window → iframe → /panel   (polls /latc/state every 5s)
```
The server only binds to 127.0.0.1 (your PC only), starts when Live mode turns on, is GET-only, and
serves nothing but VATSIM frequencies.

## POC install (manual, one time)
1. Copy the folder `abrp-ingamepanels-liveatc` into your MSFS **Community** folder
   (the same folder ABRP activates scenery into). If the icon doesn't appear in the toolbar,
   try the other Community folder (MSFS 2024 has one for 2024 packages and one for 2020-format
   packages — this is a 2020-format package).
2. Start ABRP and turn **Live mode** on (Live ATC tab) — this starts the local server.
3. Launch MSFS, start a flight, open the toolbar (top-center menu) → click the **ABRP** icon.

## POC validation checklist
- [ ] Toolbar shows the ABRP icon
- [ ] Panel opens and shows live data within ~10 s
- [ ] Recommendation updates as you taxi / tune
- [ ] Panel still visible in EXCLUSIVE FULLSCREEN (the whole point)
- [ ] FPS feels unaffected with the panel open
- [ ] Panel drag/resize acceptable

## Rebuilding layout.json
MSFS validates the file sizes listed in `layout.json` — after ANY edit to the package files run:
```
node ingamepanel/gen_layout.js
```

## Attribution / license note
The panel shell is based on the community toolbar-window template by **Maximus**
([bymaximus/msfs2020-toolbar-window-template](https://github.com/bymaximus/msfs2020-toolbar-window-template)),
the same base used by the SimAware and Cockpit Companion panels. The prebuilt
`InGamePanels/*.spb` (the toolbar registration) comes from that template unchanged — internal names
(`CustomPanel`, `PANEL_CUSTOM_PANEL`, the icon filename) are bound by it and must not be renamed.
The template repo has no explicit license: fine for personal use (this POC); before ABRP ever
distributes this package publicly, either get license clarity or rebuild the .spb from our own XML
with the MSFS SDK's fspackagetool (source XML pattern is in the template's Build folder).
