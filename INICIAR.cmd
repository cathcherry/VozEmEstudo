@echo off
setlocal
cd /d "%~dp0"
title Voz em Estudo - Servidor e Worker
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale Node.js 22.19+ ou 24.
  pause
  exit /b 1
)
if not exist "backend\.env" (
  echo [ERRO] Arquivo backend\.env nao encontrado.
  pause
  exit /b 1
)
if not exist "backend\node_modules\@gradio\client" (
  echo Instalando dependencias do backend... 
  call npm.cmd ci --prefix backend
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias. Confira a internet e o Node.js.
    pause
    exit /b 1
  )
)
echo Iniciando servidor e worker reais...
node scripts\full\start.mjs
if errorlevel 1 echo [ERRO] Verifique as mensagens acima e o README.md.
pause
