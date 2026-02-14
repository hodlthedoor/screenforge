#!/bin/bash
# ScreenForge production startup script
# pm2 has issues running ESM modules directly; bash wrapper ensures reliable startup
exec node dist/index.js
