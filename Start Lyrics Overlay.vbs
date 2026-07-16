Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"

shell.CurrentDirectory = scriptDir
shell.Run """" & electronExe & """ .", 0, False
