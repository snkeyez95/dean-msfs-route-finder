; ABRP custom NSIS hooks (wired via package.json build.nsis.include)
;
; customInit — force-close any running/stuck ABRP before installing (v6.6.3). Proven need 2026-07-09:
; a windowless zombie instance (the overlay-window lifecycle bug) held a lock on the exe, so silent
; auto-updates FAILED without any error and the installed app silently stayed on the old version.
; The app itself guards against updating mid-capture (renderer-side), so killing here is safe.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "A Better Route Planner.exe"'
!macroend

; customUnInstall — clean-uninstall prompt. On a REAL uninstall, offer to also remove the app's
; data folders so nothing is left behind (Revo-clean); default is NO because the data includes
; irreplaceable flight logs. ${isUpdated} guards the auto-updater path: when electron-updater
; replaces the app it runs this same uninstaller, and prompting/deleting there would destroy the
; user's data on every update — so we do nothing at all in that case.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Also remove your A Better Route Planner data?$\r$\n$\r$\nThis permanently deletes your settings, routes, and ALL LOGGED FLIGHT DATA under:$\r$\n$APPDATA\A Better Route Planner$\r$\n$\r$\nChoose No to keep everything for a future reinstall." /SD IDNO IDNO abrpKeepData
      RMDir /r "$APPDATA\A Better Route Planner"
      RMDir /r "$APPDATA\dean-msfs-route-finder"
      RMDir /r "$LOCALAPPDATA\dean-msfs-route-finder-updater"  ; electron-updater download cache (found on disk 2026-07-05)
    abrpKeepData:
  ${endIf}
!macroend
