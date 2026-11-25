@echo off
setlocal
cd /d "%~dp0"
title Voz em Estudo
echo.
echo  ==========================================
echo   Voz em Estudo - iniciar no computador
echo  ==========================================
echo   Versao publicada (sem instalar nada):
echo   https://vozemestudo-production.up.railway.app
echo.

rem 1. Node.js 22.19 ou mais novo
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node.js 24 LTS em https://nodejs.org
  echo        e abra este arquivo de novo.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)"
if errorlevel 1 (
  echo [ERRO] Este projeto precisa do Node.js 22.19 ou mais novo. Versao instalada:
  node --version
  pause
  exit /b 1
)

rem 2. Configuracao privada (chaves do Supabase e dos provedores de IA)
if not exist "backend\.env" (
  copy /y "backend\.env.example" "backend\.env" >nul
  echo [AVISO] Criei o arquivo backend\.env a partir do modelo.
  echo         Preencha as chaves do Supabase e dos provedores de IA, salve o arquivo
  echo         e abra o INICIAR.cmd de novo. Explicacao de cada variavel: docs\CONFIGURACAO.md
  start "" notepad "backend\.env"
  pause
  exit /b 1
)

rem 3. Dependencias (so na primeira vez; precisa de internet)
if not exist "backend\node_modules\express" (
  echo Instalando dependencias do backend, isso leva alguns minutos...
  call npm.cmd ci --prefix backend
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias. Confira a internet e o Node.js.
    pause
    exit /b 1
  )
)

rem 4. API + worker; o navegador abre quando o servidor tiver tido tempo de subir
echo Iniciando o servidor e o worker. Deixe esta janela aberta; Ctrl+C encerra.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000/painel.html"
node scripts\full\start.mjs
if errorlevel 1 echo [ERRO] Veja as mensagens acima e a secao "Rodar no computador" do README.md.
pause
