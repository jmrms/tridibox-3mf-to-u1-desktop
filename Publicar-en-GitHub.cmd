@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Tridibox - Publicar en GitHub

set "ROOT=%~dp0"
set "REPOSITORY_NAME=tridibox-3mf-to-u1-desktop"
set "VERSION=1.2.1"
set "TAG=v1.2.1"
set "PORTABLE=%ROOT%release\Tridibox-3MF-to-U1-Desktop-1.2.1-Portable.exe"
set "SOURCE=%ROOT%release\Tridibox-3MF-to-U1-Desktop-1.2.1-Codigo-Fuente.zip"

echo.
echo TRIDIBOX - PUBLICACION AUTOMATICA EN GITHUB
echo ==================================================

call :find_git
if not defined GIT call :install_git
if not defined GIT goto :missing_git
for %%D in ("%GIT%") do set "PATH=%%~dpD;%PATH%"

call :find_gh
if not defined GH call :install_gh
if not defined GH goto :missing_gh

echo.
echo [1/5] Comprobando el acceso a GitHub...
"%GH%" auth status --hostname github.com >nul 2>&1
if errorlevel 1 (
    echo Se abrira GitHub en el navegador.
    echo Use la cuenta que ya esta iniciada y autorice el acceso una sola vez.
    "%GH%" auth login --hostname github.com --web --git-protocol https
    if errorlevel 1 (
        rem GitHub CLI puede devolver error si Git se instalo en esta misma ventana,
        rem aun cuando la autorizacion ya haya sido aceptada. Verificamos la sesion.
        "%GH%" auth status --hostname github.com >nul 2>&1
        if errorlevel 1 goto :auth_error
    )
)

set "ACCOUNT_FILE=%TEMP%\tridibox-github-account-%RANDOM%.txt"
"%GH%" api user --jq .login > "%ACCOUNT_FILE%"
set "GITHUB_LOGIN="
set /p GITHUB_LOGIN=<"%ACCOUNT_FILE%"
del /q "%ACCOUNT_FILE%" >nul 2>&1
if not defined GITHUB_LOGIN goto :auth_error

set "FULL_REPOSITORY=%GITHUB_LOGIN%/%REPOSITORY_NAME%"
echo Cuenta confirmada: %GITHUB_LOGIN%

if not exist "%PORTABLE%" goto :missing_files
if not exist "%SOURCE%" goto :missing_files

echo.
echo [2/5] Preparando el codigo fuente...
"%GH%" repo view "%FULL_REPOSITORY%" >nul 2>&1
if errorlevel 1 goto :create_repository

set "WORK=%TEMP%\tridibox-publish-%RANDOM%%RANDOM%"
echo El repositorio ya existe. Se actualizara sin borrar su historial.
"%GH%" repo clone "%FULL_REPOSITORY%" "%WORK%"
if errorlevel 1 goto :repository_error

robocopy "%ROOT%" "%WORK%" /E /XD "%ROOT%.git" "%ROOT%node_modules" "%ROOT%release" /XF "*.log" >nul
if errorlevel 8 goto :copy_error
if exist "%WORK%\PUBLICAR_GITHUB.ps1" del /q "%WORK%\PUBLICAR_GITHUB.ps1" >nul 2>&1

cd /d "%WORK%"
"%GIT%" config user.name "Tridibox"
"%GIT%" config user.email "%GITHUB_LOGIN%@users.noreply.github.com"
"%GIT%" add --all
"%GIT%" diff --cached --quiet
if errorlevel 1 "%GIT%" commit -m "Prepare Tridibox %VERSION% for SignPath"
"%GIT%" push origin main
if errorlevel 1 goto :repository_error
goto :repository_ready

:create_repository
cd /d "%ROOT%"
if not exist "%ROOT%.git" "%GIT%" init --initial-branch=main
"%GIT%" config user.name "Tridibox"
"%GIT%" config user.email "%GITHUB_LOGIN%@users.noreply.github.com"
"%GIT%" add --all
"%GIT%" diff --cached --quiet
if errorlevel 1 "%GIT%" commit -m "Release Tridibox 3MF to U1 Desktop %VERSION%"

echo.
echo [3/5] Creando el repositorio publico...
rem ROOT termina con una barra invertida. En Windows, pasar esa ruta entre
rem comillas puede unir los argumentos siguientes. Ya estamos dentro de ROOT,
rem por eso usamos el directorio actual como origen.
"%GH%" repo create "%REPOSITORY_NAME%" --public --source "." --remote origin --push --description "Conversor 3MF local y offline para Snapmaker U1"
if errorlevel 1 (
    rem Si GitHub alcanzo a crear el repositorio antes de devolver un error,
    rem lo detectamos y continuamos sin intentar duplicarlo.
    "%GH%" repo view "%FULL_REPOSITORY%" >nul 2>&1
    if errorlevel 1 goto :repository_error
    "%GIT%" remote get-url origin >nul 2>&1
    if errorlevel 1 "%GIT%" remote add origin "https://github.com/%FULL_REPOSITORY%.git"
    "%GIT%" push -u origin main
    if errorlevel 1 goto :repository_error
)

:repository_ready
echo.
echo [4/5] Creando o actualizando la release %TAG%...
"%GH%" release view "%TAG%" --repo "%FULL_REPOSITORY%" >nul 2>&1
if errorlevel 1 (
    "%GH%" release create "%TAG%" "%PORTABLE%" "%SOURCE%" --repo "%FULL_REPOSITORY%" --target main --title "Tridibox 3MF to U1 Desktop %VERSION%" --notes "Primera publicacion publica preparada para evaluacion de SignPath Foundation. Aplicacion Windows portable, local y sin telemetria."
) else (
    "%GH%" release upload "%TAG%" "%PORTABLE%" "%SOURCE%" --repo "%FULL_REPOSITORY%" --clobber
)
if errorlevel 1 goto :release_error

echo.
echo [5/5] Verificando los enlaces...
echo.
echo PUBLICACION TERMINADA CORRECTAMENTE
echo ==================================================
echo Repositorio:
"%GH%" repo view "%FULL_REPOSITORY%" --json url --jq .url
echo.
echo Release:
"%GH%" release view "%TAG%" --repo "%FULL_REPOSITORY%" --json url --jq .url
echo ==================================================
echo.
echo Envie esos dos enlaces en el chat para continuar con SignPath.
start "" "https://github.com/%FULL_REPOSITORY%"
goto :success

:find_git
set "GIT="
for %%G in (git.exe) do set "GIT=%%~$PATH:G"
if not defined GIT if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
exit /b 0

:find_gh
set "GH="
for %%G in (gh.exe) do set "GH=%%~$PATH:G"
if not defined GH if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
if not defined GH if exist "%ProgramFiles(x86)%\GitHub CLI\gh.exe" set "GH=%ProgramFiles(x86)%\GitHub CLI\gh.exe"
exit /b 0

:install_git
echo Git no esta instalado. Intentando instalarlo con winget...
winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
call :find_git
exit /b 0

:install_gh
echo GitHub CLI no esta instalado. Intentando instalarlo con winget...
winget install --id GitHub.cli --exact --source winget --accept-package-agreements --accept-source-agreements
call :find_gh
exit /b 0

:missing_git
echo.
echo ERROR: No se pudo encontrar o instalar Git.
echo Reinicie Windows y ejecute nuevamente este archivo.
goto :failure

:missing_gh
echo.
echo ERROR: No se pudo encontrar o instalar GitHub CLI.
echo Reinicie Windows y ejecute nuevamente este archivo.
goto :failure

:auth_error
echo.
echo ERROR: GitHub no confirmo el acceso.
echo No se publico ningun archivo nuevo.
goto :failure

:missing_files
echo.
echo ERROR: Faltan el EXE o el ZIP de codigo dentro de la carpeta release.
echo Extraiga el paquete completo antes de ejecutarlo.
goto :failure

:copy_error
echo.
echo ERROR: No se pudo preparar la actualizacion del repositorio.
goto :failure

:repository_error
echo.
echo ERROR: No se pudo crear o actualizar el repositorio.
goto :failure

:release_error
echo.
echo ERROR: El repositorio existe, pero no se pudo crear la release.
goto :failure

:failure
echo.
echo La publicacion no pudo completarse. Copie o fotografie este mensaje.
pause
exit /b 1

:success
echo.
pause
exit /b 0
