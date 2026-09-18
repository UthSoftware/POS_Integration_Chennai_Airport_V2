# Remove old task (if exists)
Unregister-ScheduledTask -TaskName "VidvedaPOS_Worker_Startup" -Confirm:$false -ErrorAction SilentlyContinue

# Create action
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"D:\VendorSide\start-invisible.vbs"'

# Create THREE triggers
$trigger1 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$trigger2 = New-ScheduledTaskTrigger -AtStartup
$trigger3 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"

# Create principal and settings
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

# Register task
Register-ScheduledTask -TaskName "VidvedaPOS_Worker_Startup" -Action $action -Trigger $trigger1,$trigger2,$trigger3 -Principal $principal -Settings $settings -Description "Monitor VidvedaPOS - runs at startup, logon, and every 5 minutes" -Force

# Set indefinite repetition
$task = Get-ScheduledTask -TaskName "VidvedaPOS_Worker_Startup"
$task.Triggers[0].Repetition.Duration = ""
$task | Set-ScheduledTask

Write-Host "Task created successfully!" -ForegroundColor Green
Write-Host "  - Runs EVERY 5 MINUTES" -ForegroundColor Cyan
Write-Host "  - Runs at SYSTEM STARTUP" -ForegroundColor Cyan
Write-Host "  - Runs at USER LOGON" -ForegroundColor Cyan