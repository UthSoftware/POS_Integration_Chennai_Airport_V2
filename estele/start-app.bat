@echo off
cd /d "D:\VendorSide"
pm2 start ecosystem.config.js
exit