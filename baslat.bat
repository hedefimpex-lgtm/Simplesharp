@echo off
title Sharp3D
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js bulunamadi. Lutfen once https://nodejs.org adresinden LTS surumunu kurun,
  echo sonra bu dosyaya tekrar cift tiklayin.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Ilk calistirma: gerekli paketler indiriliyor, bu birkac dakika surebilir...
  call npm install
  if errorlevel 1 (
    echo Paketler indirilemedi. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
  )
)

echo.
echo Sharp3D baslatiliyor. Tarayici birazdan acilacak.
echo Kapatmak icin bu pencereyi kapatin.
echo.
call npm run dev -- --open
pause
