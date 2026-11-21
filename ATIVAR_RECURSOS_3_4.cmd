@echo off
setlocal
cd /d "%~dp0"
title Voz em Estudo - Ativar recursos da 3.4
node scripts\release\enable-3-4-features.mjs backend\.env
pause
