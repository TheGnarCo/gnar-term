; Add gnar-term to the system PATH on install, remove on uninstall.
; Uses the EnVar plugin bundled with Tauri's NSIS toolchain.

!macro NSIS_HOOK_POSTINSTALL
  ; Add the install directory to the user PATH so `gnar-term` works from any shell.
  EnVar::SetHKCU
  EnVar::AddValue "PATH" "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Clean up the PATH entry we added during install.
  EnVar::SetHKCU
  EnVar::DeleteValue "PATH" "$INSTDIR"
!macroend
