@echo off
chcp 65001 >nul
title Chef de Geladeira Vazia
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 20 ou mais novo: https://nodejs.org & pause & exit /b)
if not exist .env (echo Falta o arquivo .env. Copie o .env.example para .env e preencha. & pause & exit /b)
if not exist node_modules (echo Instalando dependencias... & call npm install)
start "" http://localhost:3000
call npm start
pause
