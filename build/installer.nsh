; ABRP custom NSIS hooks (wired via package.json build.nsis.include)
;
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
    abrpKeepData:
  ${endIf}
!macroend
