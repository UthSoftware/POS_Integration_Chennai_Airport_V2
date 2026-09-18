Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""cd /d ""D:\Uth-Vidvedaa Integration\POSIntegration"" && C:\Users\Dell\AppData\Roaming\npm\pm2.cmd start ecosystem.config.js""", 0, False
Set WshShell = Nothing