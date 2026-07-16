# Lyricslay is a tray app — closing its window just hides it (so the X
# button doesn't kill background lyrics detection) rather than quitting, and
# it runs as several processes on Windows (main, renderer, GPU, utility — all
# sharing the "Lyricslay.exe" image name). Between the two, electron-
# builder's own built-in "wait for the running app to close" retry (in
# installSection.nsh) can run out before every one of them has actually
# exited, surfacing as "Lyricslay cannot be closed. Please close it
# manually." — whether installing fresh over an already-running copy or
# installing an update. Forcefully closing all of them here, in customInit
# (runs in .onInit, before that retry logic and before file extraction even
# starts), gives it a head start so that later retry never has anything left
# to do.
#
# FIND_PROCESS and APP_EXECUTABLE_FILENAME come from electron-builder's own
# NSIS templates (allowOnlyOneInstallerInstance.nsh / common.nsh), already
# included by the time customInit runs — no extra plugin dependency beyond
# what electron-builder itself already relies on. The retry loop below
# mirrors the one in allowOnlyOneInstallerInstance.nsh's own doStopProcess,
# using the same FIND_PROCESS/taskkill pattern rather than introducing a new
# one, just run earlier and for the app itself instead of a rival installer.
!macro customInit
  StrCpy $R1 0

  killLoop:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto killLoopDone
    ${endIf}

    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    nsExec::Exec 'taskkill /f /im "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    Sleep 500

    IntOp $R1 $R1 + 1
    ${if} $R1 < 8
      Goto killLoop
    ${endIf}

  killLoopDone:
!macroend
