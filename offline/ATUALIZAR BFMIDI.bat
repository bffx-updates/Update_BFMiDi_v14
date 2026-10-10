@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title BFMiDi - Instalador Offline
cd /d "%~dp0"

REM ===========================================================================
REM BFMiDi - INSTALADOR / ATUALIZADOR OFFLINE (Windows, sem instalar nada)
REM
REM Para o cliente que nao consegue atualizar pelo site (navegador sem Web
REM Serial, firmware antigo com PID 0x0002 que faz o site pular o reset, rede
REM bloqueada, etc). Roda 100% local: usa o esptool.exe que vem na pasta
REM tools\ e os binarios em bin\. Nao precisa de Python, driver extra nem
REM internet.
REM
REM SO ESP32-S2: hoje toda unidade em campo e S2. Se um dia o S3 (BFMiDi 3
REM 8SW+) entrar em producao, este script precisa voltar a escolher o chip -
REM os offsets mudam (bootloader 0x0 e littlefs 0x400000 no S3).
REM
REM Diferenca proposital para o site: aqui o 1200 bps touch e SEMPRE feito
REM (o site pula quando o PID e 0x0002 e por isso trava em firmware antigo).
REM
REM Offsets (iguais aos do "flash lote esp32.bat" do repo, ESP32-S2):
REM   bootloader 0x1000 | partitions 0x8000 | app 0x10000 | littlefs 0x280000
REM ===========================================================================

set "ESPTOOL=%~dp0tools\esptool.exe"
set "DETECT=%~dp0tools\detect_pedal.ps1"
set "BINDIR=%~dp0bin"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass"

if not exist "%ESPTOOL%" (
  echo.
  echo   ERRO: nao achei tools\esptool.exe.
  echo   Descompacte o ZIP INTEIRO numa pasta antes de rodar ^(nao rode de
  echo   dentro do ZIP^).
  echo.
  pause & exit /b 1
)
if not exist "%BINDIR%\firmware.bin" (
  echo.
  echo   ERRO: nao achei bin\firmware.bin. Descompacte o ZIP INTEIRO
  echo   numa pasta antes de rodar.
  echo.
  pause & exit /b 1
)

cls
echo.
echo  ============================================================
echo    BFMiDi - ATUALIZACAO OFFLINE
echo  ============================================================
echo.
echo    Esta atualizacao regrava o firmware E o editor de tela.
echo    Seus presets voltam ao padrao de fabrica.
echo.
echo    Antes de comecar:
echo      1. Feche o editor BFMiDi, o Arduino IDE e qualquer monitor serial.
echo      2. Ligue o pedal no PC com um cabo USB de DADOS ^(cabo so de carga
echo         nao funciona - o PC precisa "ver" o pedal^).
echo      3. Se quiser guardar seus presets, faca um BACKUP pelo editor
echo         ^(SYSTEM ^> MANUTENCAO ^> Backup^) ANTES de atualizar.
echo  ------------------------------------------------------------

if not exist "%BINDIR%\littlefs.bin" (
  echo.
  echo    [x] Falta o bin\littlefs.bin neste pacote. Peca ao suporte o
  echo        instalador completo.
  echo.
  pause & exit /b 1
)

set "MANUAL="

:start
echo.
echo  ------------------------------------------------------------
if defined MANUAL (
  echo    Deixe o pedal em modo gravacao ^(segure BOOT, toque RESET, solte
  echo    BOOT^) e tecle ENTER.    ^(Q + ENTER = sair^)
) else (
  echo    Ligue o pedal no PC e tecle ENTER para comecar.
  echo    ^(Q + ENTER = sair^)
)
echo  ------------------------------------------------------------
set "KEY="
set /p "KEY=> "
if /i "!KEY!"=="Q" exit /b 0

REM -- 1) acha o pedal na USB (VID Espressif 303A) ----------------------------
call :detect
if not defined PORT (
  echo.
  echo    [x] Nao encontrei nenhum pedal BFMiDi na USB.
  echo        - troque o cabo por um de DADOS
  echo        - tente outra porta USB ^(de preferencia atras do gabinete^)
  echo        - desligue e ligue o pedal
  goto :retry
)
echo.
echo    Pedal encontrado em !PORT!.

REM -- 2) modo gravacao: manual (ja feito pelo usuario) ou 1200 bps touch -----
REM ROM = PID 0x0002 no S2. Nao da pra confiar so nisso: firmware antigo
REM enumera o app com o MESMO 0x0002 (foi por isso que o site quebrou), entao
REM o touch e feito sempre e o PID serve so pra decidir se repito o touch.
if defined MANUAL goto :do_flash

REM Guarda como o pedal estava ANTES do reinicio. Comparar isso com o depois
REM diz se a USB re-enumerou de verdade (COM/PID mudaram) ou se o Windows
REM ficou com a porta velha - o caso em que a tela do pedal trava (ou seja, o
REM chip ENTROU no ROM) mas a porta nao volta utilizavel.
set "PORT0=!PORT!"
set "PID0=!USBPID!"

set /a TOUCHES=0
:touchloop
set /a TOUCHES+=1
echo    Colocando o pedal em modo gravacao... ^(tentativa !TOUCHES!^)
%PS% -Command "try { $p = New-Object System.IO.Ports.SerialPort '!PORT!',1200,'None',8,'One'; $p.DtrEnable=$false; $p.RtsEnable=$false; $p.Open(); Start-Sleep -Milliseconds 250; $p.Close() } catch { exit 0 }"
REM Espera o Windows re-enumerar o ROM: ate ~12 s (PC lento / hub USB demora
REM bem mais que os 2,5 s que pareciam suficientes na bancada).
set /a WAITS=0
:waitport
%PS% -Command "Start-Sleep -Milliseconds 2000"
call :detect
if defined PORT goto :portback
set /a WAITS+=1
if !WAITS! LSS 6 (
  echo      aguardando o pedal reaparecer... ^(!WAITS!/6^)
  goto :waitport
)
echo.
echo    [x] O pedal sumiu da USB depois do reset e nao voltou.
echo        - se voce desconectou o cabo, ligue de novo e tente
echo        - alguns cabos/hubs derrubam a porta no reinicio: ligue o
echo          pedal direto numa USB do PC, sem hub
goto :retry
:portback
if defined ROM goto :do_flash
if !TOUCHES! LSS 2 goto :touchloop

REM -- 3) DIAGNOSTICO: confirma modo gravacao + chip + memoria antes de gravar -
REM Sonda de leitura pura (flash_id), --no-stub pra nao deixar o stub carregado
REM e --after no_reset pra manter o pedal em modo gravacao pro write_flash que
REM vem logo em seguida. O exit code e IGNORADO de proposito: na USB nativa do
REM S2 a limpeza da porta com no_reset costuma dar "Cannot configure port"
REM mesmo tendo lido tudo - o que vale e o texto que ele imprimiu.
:do_flash
set "PROBE=%TEMP%\bfmidi_diag.txt"
set "DL="
set "CHIPFOUND="
set "FLASHV="
set "MACV="

REM Zera o log a cada rodada. Sem isso, uma tentativa que nem chega a chamar o
REM esptool (porta que nao abre) copiaria pro diagnostico.txt a saida da rodada
REM ANTERIOR - o suporte receberia um log de sucesso num caso de falha.
> "!PROBE!" echo BFMiDi - diagnostico do instalador offline
>> "!PROBE!" echo data: %DATE% %TIME%

REM Ate 3 sondagens: a COM aparece no Windows alguns instantes ANTES de aceitar
REM conexao, e em PC lento a primeira tentativa pega a porta ainda "crua".
set /a PROBES=0
set "PORTBUSY="
:probeloop
set /a PROBES+=1
echo.
if !PROBES! GTR 1 (
  echo    Checando o pedal em !PORT!... ^(tentativa !PROBES! de 3^)
) else (
  echo    Checando o pedal em !PORT!...
)

REM Antes do esptool: da pra ABRIR a porta? Separa dois problemas que o cliente
REM veria como um so - "o Windows nao entrega a porta" (driver/cabo/hub/porta
REM fantasma; da OSError 121 "semaforo expirou") x "a porta abre mas o chip nao
REM responde" (nao esta em modo gravacao). 115200 e DTR/RTS default = nao
REM reinicia nada; so o 1200 bps reinicia.
set "PORTBUSY="
>> "!PROBE!" echo.
>> "!PROBE!" echo === tentativa !PROBES! - porta !PORT! - PID USB !USBPID! ===
REM A mensagem do Windows vai pro log: e ela que diferencia "semaforo expirou"
REM (porta travada) de "acesso negado" (outro programa segurando).
%PS% -Command "try { $p = New-Object System.IO.Ports.SerialPort '!PORT!',115200,'None',8,'One'; $p.Open(); $p.Close(); Write-Output 'abertura da porta: OK'; exit 0 } catch { Write-Output ('abertura da porta: FALHOU -^> ' + $_.Exception.Message); exit 1 }" >> "!PROBE!" 2>&1
if errorlevel 1 (
  set "PORTBUSY=1"
  echo      a porta !PORT! nao abriu nesta tentativa...
  if !PROBES! LSS 3 (
    %PS% -Command "Start-Sleep -Milliseconds 2500"
    call :detect
    goto :probeloop
  )
  goto :probedone
)
REM --chip auto (e nao esp32s2) de proposito: se o pedal for do modelo novo,
REM quero LER "ESP32-S3" e avisar, em vez de tomar um erro de chip mismatch.
"%ESPTOOL%" --chip auto --port !PORT! --before no_reset --after no_reset --no-stub flash_id >> "!PROBE!" 2>&1

findstr /i /c:"ESP32-S2" "!PROBE!" >nul 2>&1 && set "CHIPFOUND=ESP32-S2"
findstr /i /c:"ESP32-S3" "!PROBE!" >nul 2>&1 && set "CHIPFOUND=ESP32-S3"
findstr /i /c:"Connected to" "!PROBE!" >nul 2>&1 && set "DL=1"
for /f "tokens=2 delims=:" %%A in ('findstr /i /c:"flash size" "!PROBE!" 2^>nul') do for /f "tokens=*" %%B in ("%%A") do set "FLASHV=%%B"
for /f "tokens=1,2" %%A in ('findstr /i /b /c:"MAC:" "!PROBE!" 2^>nul') do set "MACV=%%B"

if not defined DL if !PROBES! LSS 3 (
  %PS% -Command "Start-Sleep -Milliseconds 2500"
  call :detect
  goto :probeloop
)

:probedone
REM Causa provavel (so quando nao conectou). A porta nao abrir e diagnostico
REM DIFERENTE de o chip nao responder - o texto de ajuda muda por causa disso.
set "CAUSA="
if defined DL goto :causaok

REM Quem manda e o PORTBUSY da ULTIMA tentativa, nao o findstr: o log acumula
REM as 3 tentativas, entao um "negado" de uma tentativa antiga diria "porta
REM ocupada" mesmo que na ultima a porta tenha aberto e o chip e que calou.
if defined PORTBUSY goto :causaporta

findstr /i /c:"Failed to connect" /c:"No serial data received" /c:"Timed out" "!PROBE!" >nul 2>&1 && set "CAUSA=o pedal nao entrou em modo gravacao"
goto :causaok

:causaporta
REM Padroes em PT e EN: o texto do .NET/Windows vem TRADUZIDO na maquina do
REM cliente ("O acesso a porta 'COM5' foi negado", "O tempo limite do semaforo
REM expirou"), entao procurar so os termos em ingles nao acha nada.
set "CAUSA=o Windows nao entrega a porta !PORT!"
findstr /i /c:"negado" /c:"Access is denied" /c:"PermissionError" "!PROBE!" >nul 2>&1 && set "CAUSA=PORTA OCUPADA por outro programa"
:causaok

REM Re-enumerou? Mesma COM + mesmo PID depois do reinicio = a USB NAO voltou.
set "REENUM="
if defined PORT0 (
  if "!PORT0!"=="!PORT!" (
    if "!PID0!"=="!USBPID!" ( set "REENUM=NAO" ) else ( set "REENUM=SIM" )
  ) else (
    set "REENUM=SIM"
  )
)

echo.
echo  ------------------------------------------------------------
echo    DIAGNOSTICO
echo  ------------------------------------------------------------
echo     Porta USB ........ !PORT!
if defined REENUM (
  if "!REENUM!"=="NAO" (
    echo     Re-enumerou ...... NAO - continua !PORT0! / PID !PID0!
  ) else (
    echo     Re-enumerou ...... SIM - era !PORT0! / PID !PID0!
  )
)
REM PID cru: 0002 = ROM em modo gravacao (S2). 80C2 = app do pedal rodando -
REM aparecer aqui depois do touch significa que o reinicio NAO pegou.
if /i "!USBPID!"=="0002" (
  echo     Estado USB ....... PID 0002 - modo gravacao ^(ROM^)
) else if /i "!USBPID!"=="80C2" (
  echo     Estado USB ....... PID 80C2 - firmware do pedal rodando
) else (
  if defined USBPID echo     Estado USB ....... PID !USBPID!
)
if defined PORTBUSY (
  echo     Porta abre ....... NAO - o Windows recusou
) else (
  echo     Porta abre ....... OK
)
if defined DL (
  echo     Modo gravacao .... OK - o pedal respondeu
) else (
  if /i "!USBPID!"=="0002" (
    echo     Modo gravacao .... SIM pelo PID, mas a porta nao respondeu
  ) else (
    echo     Modo gravacao .... NAO CONFIRMADO
  )
  if defined CAUSA echo     Motivo provavel .. !CAUSA!
)
if defined CHIPFOUND (
  echo     Chip ............. !CHIPFOUND!
) else (
  echo     Chip ............. nao identificado
)
if defined FLASHV echo     Memoria .......... !FLASHV!
if defined MACV   echo     Serie ............ !MACV!
echo  ------------------------------------------------------------

REM Pedal do modelo novo (S3) - este pacote so tem binario de S2. Gravar aqui
REM deixaria a placa sem bootloader valido, entao PARA.
if /i "!CHIPFOUND!"=="ESP32-S3" (
  echo.
  echo    [x] PAREI: este e um BFMiDi 3 8SW+ ^(chip novo^) e este instalador
  echo        so tem o firmware da linha BFMiDi 1 / 2 / 3.
  echo        Peca ao suporte o instalador do 8SW+. Nada foi gravado.
  echo.
  pause
  exit /b 1
)

REM Qual ajuda mostrar. Tres casos bem diferentes, resolvidos em variavel e
REM nao com if/else aninhado (um "else" preso no if de dentro deixaria o caso
REM CHIP sem nenhuma mensagem):
REM   PC    = esta em modo gravacao (PID 0002) mas o Windows nao usa a porta
REM   PORTA = a porta nao abre e nao da pra dizer se entrou em modo gravacao
REM   CHIP  = a porta abre, mas o pedal nao respondeu (nao esta no bootloader)
set "AJUDA=CHIP"
if defined PORTBUSY set "AJUDA=PORTA"
if defined PORTBUSY if /i "!USBPID!"=="0002" set "AJUDA=PC"

if not defined DL (
  copy /y "!PROBE!" "%~dp0diagnostico.txt" >nul 2>&1
  echo.
  if "!AJUDA!"=="PC" (
    REM PID 0002 = ROM do S2: o pedal ESTA em modo gravacao e a USB enumerou.
    REM Se mesmo assim a porta nao abre, o problema e 100%% do lado do PC
    REM (driver/cabo/porta) - mandar fazer BOOT+RESET aqui so perde tempo.
    echo    BOA NOTICIA: o pedal ESTA em modo gravacao - o PID 0002 confirma.
    echo    O que falhou foi o COMPUTADOR nao conseguir usar a porta !PORT!.
    echo    Isso e driver/cabo/porta USB do PC, nao e o pedal. Faca nesta ordem:
    echo.
    echo      1. Troque a PORTA USB: use uma de TRAS do gabinete, de preferencia
    echo         USB 2.0. Evite hub, extensao, USB de monitor ou de teclado.
    echo      2. Troque o CABO por outro de DADOS.
    echo      3. Limpe o driver da porta: Gerenciador de Dispositivos ^>
    echo         Portas ^(COM e LPT^) ^> botao direito na porta do pedal ^>
    echo         Desinstalar dispositivo. Depois tire e recoloque o cabo.
    echo      4. Reinicie o computador e rode este instalador ANTES de abrir
    echo         qualquer outro programa.
    echo      5. Nao resolvendo, teste em OUTRO computador - esse erro
    echo         ^("tempo limite do semaforo"^) e quase sempre da maquina.
    echo.
    echo    O pedal nao foi danificado: ele fica esperando em modo gravacao e
    echo    volta ao normal sozinho quando voce tirar e recolocar o cabo.
  )
  if "!AJUDA!"=="PORTA" (
    REM Porta nao abre: o problema esta no WINDOWS/cabo, nao no pedal. Erro
    REM classico "o tempo limite do semaforo expirou" / "port is busy".
    echo    O Windows nao conseguiu abrir a porta !PORT!. O problema esta na
    echo    porta USB, nao no pedal.
    echo.
    echo    A TELA DO PEDAL APAGOU/TRAVOU quando comecou? Entao ele ESTA em
    echo    modo gravacao - so a porta USB que nao voltou. Isso tem conserto
    echo    facil: REINICIE A USB DO PEDAL NA MAO.
    echo.
    echo      1. SEGURE o botao BOOT, toque no RESET e SOLTE o BOOT.
    echo         O RESET refaz a conexao USB do zero ^(o reinicio automatico
    echo         tenta aproveitar a conexao antiga, e as vezes ela trava^).
    echo         Depois responda N aqui, S em "tentar de novo" e S quando eu
    echo         perguntar do boot manual.
    echo      2. Se o pedal tem fonte propria: deixe ele ligado na fonte,
    echo         tire e recoloque so o cabo USB.
    echo.
    echo    Se a tela do pedal continua normal, o caminho e outro:
    echo      3. FECHE O NAVEGADOR INTEIRO ^(todas as janelas^). Se voce tentou
    echo         atualizar pelo site antes, a pagina fica segurando a porta -
    echo         fechar so a aba nao adianta. Feche tambem o editor BFMiDi,
    echo         Arduino IDE e qualquer monitor serial.
    echo      4. Ligue o pedal DIRETO numa porta USB do PC - sem hub, sem
    echo         extensao, de preferencia uma porta de tras do gabinete.
    echo      5. Persistindo: reinicie o computador ^(o Windows as vezes deixa
    echo         a porta presa ate reiniciar^).
  )
  if "!AJUDA!"=="CHIP" (
    echo    A porta abriu, mas o pedal nao respondeu como esperado - ou seja,
    echo    ele nao esta em modo gravacao. Quase sempre e firmware antigo, que
    echo    nao aceita o reinicio automatico. O jeito certo e fazer na mao:
    echo.
    echo    MODO GRAVACAO NA MAO: com o pedal ligado no PC, SEGURE o botao
    echo    BOOT, toque no RESET e SOLTE o BOOT.
    echo    Depois responda N aqui, S em "tentar de novo" e S quando eu
    echo    perguntar do boot manual.
  )
  echo.
  echo    Salvei o detalhe tecnico em:
  echo      %~dp0diagnostico.txt
  echo.
  set "TRYANY="
  set /p "TRYANY=  Tentar gravar assim mesmo? [S/N] "
  if /i not "!TRYANY!"=="S" goto :retry
)

REM -- 4) grava tudo numa unica conexao ---------------------------------------
echo.
echo  ------------------------------------------------------------
echo    Gravando em !PORT!.
echo    NAO desconecte o cabo nem feche esta janela agora.
echo  ------------------------------------------------------------
echo.

"%ESPTOOL%" --chip esp32s2 --port !PORT! --baud 921600 --before no_reset --after hard_reset write_flash 0x1000 "%BINDIR%\bootloader.bin" 0x8000 "%BINDIR%\partitions.bin" 0x10000 "%BINDIR%\firmware.bin" 0x280000 "%BINDIR%\littlefs.bin"
if errorlevel 1 goto :failed

echo.
echo  ============================================================
REM Sem "!" nesta linha de proposito: com delayed expansion ligado o cmd come
REM o caractere mesmo escapado (^!), e sai "PRONTO Pedal atualizado".
echo    PRONTO - Pedal atualizado com sucesso.
echo  ============================================================
echo    Ele ja reiniciou sozinho. Pode desconectar o cabo.
echo    Presets: voltaram ao padrao de fabrica - restaure seu backup
echo    pelo editor ^(SYSTEM ^> MANUTENCAO^), se voce fez um.
echo.
pause
exit /b 0

:failed
echo.
echo  ------------------------------------------------------------
echo    [x] A gravacao falhou.
echo.
echo    Causas mais comuns, na ordem:
echo      - editor BFMiDi / Arduino IDE / monitor serial abertos ^(feche^)
echo      - cabo USB so de carga, ou cabo/entrada com mau contato
echo      - o pedal nao entrou em modo gravacao sozinho
echo.
echo    Da pra colocar em modo gravacao na mao: com o pedal ligado no PC,
echo    SEGURE o botao BOOT, toque no RESET e SOLTE o BOOT.
echo  ------------------------------------------------------------
if exist "!PROBE!" (
  copy /y "!PROBE!" "%~dp0diagnostico.txt" >nul 2>&1
  echo.
  echo    Salvei o diagnostico tecnico em:
  echo      %~dp0diagnostico.txt
  echo    Mande esse arquivo pro suporte junto com o print da tela.
)
goto :retry

:retry
echo.
set "AGAIN="
set /p "AGAIN=  Tentar de novo? [S/N] "
if /i not "!AGAIN!"=="S" goto :giveup
set "MANUAL="
set "M2="
set /p "M2=  Voce colocou o pedal em modo gravacao na mao (BOOT+RESET)? [S/N] "
if /i "!M2!"=="S" set "MANUAL=1"
set "PORT="
goto :start

:giveup
echo.
echo    Se nao funcionar de jeito nenhum, mande o print desta janela
echo    para o suporte BFMiDi.
echo.
pause
exit /b 1

REM -- helper: acha a COM do pedal (VID 303A) e marca ROM se PID for 0x0002 ---
:detect
set "PORT="
set "ROM="
set "USBPID="
set "DET="
if exist "%DETECT%" (
  for /f "delims=" %%P in ('%PS% -File "%DETECT%" -Field full 2^>nul') do set "DET=%%P"
) else (
  for /f "delims=" %%P in ('%PS% -Command "$d=Get-CimInstance Win32_PnPEntity ^| Where-Object { $_.Name -match 'COM\d+' -and ((($_.HardwareID -join ' ') + $_.PNPDeviceID) -match 'VID_303A') } ^| Select-Object -First 1; if ($d) { $c=[regex]::Match($d.Name,'COM\d+').Value; $h=($d.HardwareID -join ' ') + $d.PNPDeviceID; $k='-'; if ($h -match 'PID_0002') { $k='esp32s2' }; $p=[regex]::Match($h,'PID_([0-9A-Fa-f]{4})').Groups[1].Value; if (-not $p) { $p='-' }; Write-Output ($c + '^|' + $k + '^|' + $p) }" 2^>nul') do set "DET=%%P"
)
if not defined DET goto :eof
for /f "tokens=1,3 delims=|" %%A in ("!DET!") do (
  set "PORT=%%A"
  set "USBPID=%%B"
)
REM 2o campo vem preenchido ("esp32s2") so quando o PID e de ROM bootloader
if not "!DET:esp32=!"=="!DET!" set "ROM=1"
goto :eof
