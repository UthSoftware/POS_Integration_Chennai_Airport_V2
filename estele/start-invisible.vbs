Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""cd /d ""D:\VendorSide"" && C:\Users\HP\AppData\Roaming\npm\pm2.cmd start ecosystem.config.js""", 0, False
Set WshShell = Nothing