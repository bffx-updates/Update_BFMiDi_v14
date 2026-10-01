// ════════════════════════════════════════════════════════════════════════
//  BACKUP AUTOMATICO DO ATUALIZADOR
//  ---------------------------------------------------------------------
//  A gravacao por cabo regrava a particao `storage` INTEIRA — presets,
//  imagens, icones e aparelhos personalizados voltam ao padrao de fabrica.
//  Este modulo extrai tudo isso ANTES do reset pro bootloader e reinjeta
//  DEPOIS do flash, pelo mesmo canal CDC que o editor usa (USB_CONTROL.h):
//      "> METODO /rota [body]\n"  ->  "< STATUS {json}\n"
//
//  O QUE NAO ENTRA AQUI, DE PROPOSITO: a config GLOBAL (placa, brilho,
//  cores, combos, credenciais Wi-Fi). Ela vive na NVS (0x9000..0xF000) e
//  NENHUMA das regioes gravadas encosta nela — bootloader (0x0/0x1000),
//  tabela de particoes (0x8000, 1 setor), app (0x10000), otadata
//  (0x710000) e littlefs (0x280000/0x720000). Ou seja: sobrevive sozinha.
//  Alem disso, GET e POST de /config/global NAO usam os mesmos nomes de
//  campo (o GET emite `preset_call_sw_short` e `combos` como arrays; o
//  POST espera `preset_call_short_<i>` e `combo_2_5_tap`), entao devolver
//  o GET como POST aplicaria parte da config e descartaria o resto EM
//  SILENCIO. Excecao conhecida: com "Apagar memoria" marcado o erase varre
//  a NVS junto — a pagina avisa, porque ai a config global se perde mesmo.
//
//  O formato produzido e o MESMO do backup do editor (version 3), entao o
//  arquivo baixado aqui pode ser restaurado normalmente pelo editor.
// ════════════════════════════════════════════════════════════════════════

export const AUTOBACKUP_FILE_VERSION = 3;

// Tetos de payload por linha. O firmware DESCARTA a linha inteira acima de
// USB_CONTROL_LINE_MAX (4096 B) e responde um unico 413 — os valores abaixo
// sao os mesmos ja validados no editor (api.js / stores.js).
const USB_RESTORE_CHUNK = 1700;   // JSON de presets, fatiado por bytes
const USB_MEDIA_CHUNK   = 1350;   // bytes CRUS por chunk (multiplo de 3:
                                  // evita padding base64 no meio do arquivo)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── verificacao do reset (portados do esp_flash.js do editor) ───────────
// O pedal REALMENTE reiniciou? A porta que estava conectada some da lista
// (ou vira connected=false) quando o USB re-enumera. E o unico sinal
// observavel de que o reset pegou — sem ele estariamos adivinhando.
async function portWentAway(port, timeoutMs = 4000) {
  if (!port) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (port.connected === false) return true;
    try {
      const ports = await navigator.serial.getPorts();
      if (!ports.includes(port)) return true;
    } catch { /* sem API: cai no timeout */ }
    await sleep(200);
  }
  return false;
}

// 1200 bps touch — o MESMO gatilho que os .bat de gravacao usam: abrir a
// porta a 1200 baud e fechar faz o CDC do arduino-esp32 reiniciar em modo
// download. No USB nativo do S2/S3 costuma ser mais confiavel que o pulso
// DTR/RTS, que depende de o driver repassar os sinais.
async function touch1200(port) {
  if (!port) return false;
  try {
    await port.open({ baudRate: 1200 });
  } catch {
    return false;   // ainda aberta, ou a porta sumiu
  }
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch { /* driver sem sinais: o baudrate sozinho costuma bastar */ }
  await sleep(250);
  try { await port.close(); } catch { /* ja sumiu = o reset aconteceu */ }
  return true;
}

// ── util base64 ─────────────────────────────────────────────────────────
// fromCharCode.apply estoura a pilha em arrays grandes — vai em pedacos.
function bytesToBase64(bytes) {
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ════════════════════════════════════════════════════════════════════════
//  CANAL DE CONTROLE (CDC) — porte do transporte USB do editor (app.jsx)
// ════════════════════════════════════════════════════════════════════════
//
//  Regra do protocolo: NAO existe id de correlacao — resposta casa com
//  request por ORDEM. Por isso os comandos sao serializados (um em voo) e
//  um comando que estourou o timeout vira ZUMBI em vez de sair da fila:
//  removendo-o, a resposta atrasada dele deslocaria a fila e todo comando
//  seguinte receberia a resposta do anterior, PARA SEMPRE.
export async function openControl(port, log = () => {}) {
  await port.open({ baudRate: 115200 });

  const writer = port.writable.getWriter();
  const decoder = new TextDecoderStream();
  const pipe = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();

  let buf = '';
  const pending = [];
  let chain = Promise.resolve();
  let alive = true;

  // 1 MB: a leitura de midia (/img/read) vem numa LINHA UNICA e um JPEG de
  // 50 KB vira ~67 KB em base64. O teto so existe como guarda contra burst
  // de bytes sem quebra de linha (firmware resetando no meio da resposta).
  const RX_MAX = 1024 * 1024;

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buf += value;
        if (buf.length > RX_MAX) buf = buf.slice(-1024);
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const raw = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          // Respostas comecam com '<'; linhas de log do firmware nao tem
          // prefixo e sao ignoradas.
          if (!raw.startsWith('<')) continue;
          const body = raw.slice(1).replace(/^\s+/, '');
          const p = pending.shift();
          if (p && !p.zombie) p.resolve(body);
        }
      }
    } catch { /* stream morreu — tratado como desconexao */ }
    alive = false;
    pending.forEach((p) => { if (!p.zombie) p.reject(new Error('porta desconectada')); });
    pending.length = 0;
  })();

  function send(line, timeoutMs = 15000) {
    const run = async () => {
      if (!alive) throw new Error('porta desconectada');
      await writer.write(new TextEncoder().encode('> ' + line + '\n'));
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        setTimeout(() => {
          const idx = pending.findIndex((p) => p.resolve === resolve);
          if (idx >= 0) {
            pending[idx].zombie = true;   // ver comentario acima
            reject(new Error('timeout'));
          }
        }, timeoutMs);
      });
    };
    // .then(run, run): a cadeia segue viva mesmo se o comando anterior falhar.
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  async function call(method, path, body, timeoutMs) {
    let line = method + ' ' + path;
    if (body !== undefined && body !== null && body !== '') {
      line += ' ' + (typeof body === 'string' ? body : String(body));
    }
    const resp = await send(line, timeoutMs);
    const sp = resp.indexOf(' ');
    const status = parseInt(resp.slice(0, sp >= 0 ? sp : resp.length), 10);
    const bodyStr = sp >= 0 ? resp.slice(sp + 1) : '';
    if (status >= 200 && status < 300) return bodyStr ? JSON.parse(bodyStr) : {};
    let msg = 'USB ' + status;
    try { const j = JSON.parse(bodyStr); if (j.error) msg += ': ' + j.error; } catch {}
    throw new Error(msg);
  }

  // Pulso DTR/RTS NA PORTA JA ABERTA. Fechar os streams e reabrir pelo
  // Transport deixa a porta bloqueada por instantes em alguns Chromium/
  // Windows — por isso o pulso vem ANTES do close. setSignals() funciona com
  // a porta aberta. Se o USB sumir no meio, os ultimos setSignals falham:
  // significa que o reset JA aconteceu.
  //
  // Cada chamada escreve OS DOIS sinais. Escrever um de cada vez (como o
  // esp_flash.js e o Transport do esptool fazem) deixa o outro no estado que
  // o `open()` do Chrome deixou — e esse estado nao e especificado. Assim a
  // sequencia passa explicitamente por DTR=0/RTS=1, a combinacao que poe o
  // CDC do arduino-esp32 em modo download, em vez de torcer pra ela
  // acontecer por acidente.
  // TODO passo e best-effort: quando o pulso PEGA, o USB re-enumera no meio
  // da sequencia e os setSignals seguintes lancam. Tratar isso como falha
  // reportava justamente o SUCESSO como fracasso. Quem julga e o
  // portWentAway; aqui so devolvemos "a tentativa foi feita".
  async function pulseSignals() {
    if (typeof port.setSignals !== 'function') return false;
    const set = async (dtr, rts) => {
      try { await port.setSignals({ dataTerminalReady: dtr, requestToSend: rts }); }
      catch { /* re-enumerou no meio da sequencia = o reset aconteceu */ }
    };
    await set(false, false);   // ponto de partida conhecido
    await sleep(20);
    await set(false, true);    // EN baixo, GPIO0 alto
    await sleep(20);
    await set(true, true);     // GPIO0 baixo (boot) com EN ainda baixo
    await sleep(100);
    await set(true, false);    // solta o reset
    await sleep(50);
    await set(false, false);   // solta o boot
    await sleep(50);
    return true;
  }

  // Poe o pedal em modo download. CASCATA VERIFICADA, espelhando o
  // prepareFlash do editor (esp_flash.js) — o pulso DTR/RTS depende de o
  // driver repassar os sinais e NAO funciona em toda maquina; sem checar,
  // a pagina seguia achando que o pedal tinha reiniciado e o esptool falhava
  // com "Failed to connect with the device", ja sem o caminho original como
  // rede de seguranca.
  //
  // Fecha a porta em qualquer caso. Devolve TRUE so quando o USB realmente
  // re-enumerou; em FALSE quem chama tem que cair no caminho do Transport.
  async function resetToBootloader() {
    // 1a: pulso na porta aberta (unica ordem possivel — depois do close,
    // setSignals nao existe mais).
    if (await pulseSignals() && await portWentAway(port, 4000)) {
      await close();
      return true;
    }
    await close();
    await sleep(200);
    // 2a: 1200 bps touch — o MESMO gatilho dos .bat, e o mais confiavel no
    // USB nativo do S2/S3, onde o reset por sinais e emulado pelo CDC.
    if (await touch1200(port) && await portWentAway(port, 3500)) return true;
    // Deixa a porta assentar antes de devolver o controle: quem chama vai
    // reabri-la pelo Transport, e no Chromium/Windows um open logo apos o
    // close encontra a porta transitoriamente travada.
    await sleep(300);
    return false;
  }

  async function close() {
    alive = false;
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
    try { await pipe; } catch {}
    // Espera o cancelamento liberar de verdade a porta: close() pode
    // encontrar um lock transitorio e o esptool tentaria abrir cedo demais.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!port.readable && !port.writable) return;
      try { await port.close(); } catch {}
      if (!port.readable && !port.writable) return;
      await sleep(100);
    }
  }

  // PING curto: durante uma reconexao a porta aparece antes do fim do boot.
  const pong = await send('PING', 3000);
  if (!String(pong).includes('PONG')) throw new Error('pedal nao respondeu ao PING');
  log('Canal de controle aberto (PING/PONG ok).');

  return { call, send, resetToBootloader, close, port };
}

// ════════════════════════════════════════════════════════════════════════
//  PACOTE DE FABRICA (usado quando o usuario DISPENSA o backup)
// ════════════════════════════════════════════════════════════════════════
//
//  A imagem gravada ja traz um pacote assado — o `flash completo` roda o
//  backup_to_data.mjs antes do mklittlefs —, e esse pacote e o de 3.5":
//  `backup_padrao.json` e byte a byte o `Pack_3.5.json`. Entao so as placas
//  de display 2.4" (BFMiDi 1 e 2) recebem hoje o pacote errado; nas demais,
//  injetar seria regravar o que ja esta la.
//
//  Num S3 a imagem pode ter sido assada com uma base ESPECIFICA do modelo
//  (8SW+ / NANO+ da S3), mais precisa que o Pack_3.5 generico — mais um motivo
//  pra nao escrever por cima.
//
//  Quem decide e o NOME DA PLACA lido do pedal antes do reset; sem ele, cai
//  no chip (todas as placas de 2.4" sao S2). O caso que o chip sozinho erra
//  e a BFMIDI-3 7S — S2 com display 3.5" — e e exatamente isso que a
//  leitura do modelo resolve.
//
//  Devolve a URL do pacote a injetar, ou null pra "a imagem ja basta".
export function defaultPackFor(board, chip) {
  if (board) {
    return /^BFMIDI-S?3/i.test(String(board).trim()) ? null : './Pack_2.4.json';
  }
  return chip === 's2' ? './Pack_2.4.json' : null;
}

// ════════════════════════════════════════════════════════════════════════
//  EXTRACAO
// ════════════════════════════════════════════════════════════════════════

// GET /backup paginado: a resposta inteira nao cabe numa linha, entao o
// firmware devolve {seq,fin,data} com `data` = base64 de ~1,2 KB do JSON.
// Firmware anterior a paginacao IGNORA o ?seq e devolve o backup inteiro —
// esse caso e detectado pela ausencia de `data`.
async function downloadPresets(ctl, onProgress) {
  let out = '';
  for (let seq = 0; seq < 8000; seq++) {
    const r = await ctl.call('GET', '/backup?seq=' + seq, undefined, 20000);
    if (r && typeof r.data === 'string') {
      out += atob(r.data);
      onProgress({ phase: 'presets', bytes: out.length });
      if (r.fin) break;
      continue;
    }
    if (seq === 0 && r && typeof r === 'object' && r.presets) {
      onProgress({ phase: 'presets', bytes: 0 });
      return JSON.stringify(r);   // firmware antigo, resposta unica
    }
    break;
  }
  return out;
}

async function readMedia(ctl, kind, onProgress, log) {
  const out = {};
  let list;
  try {
    list = await ctl.call('GET', '/' + kind + '/list', undefined, 20000);
  } catch (e) {
    log('Lista de ' + kind + ' indisponivel (' + e.message + ') — seguindo sem.');
    return out;
  }
  const slots = Array.isArray(list && list.slots) ? list.slots : [];
  const occupied = [];
  slots.forEach((s, i) => { if (s && s.exists) occupied.push(i); });
  for (let i = 0; i < occupied.length; i++) {
    const slot = occupied[i];
    onProgress({ phase: kind === 'img' ? 'imagens' : 'icones',
                 pct: Math.round((i / occupied.length) * 100) });
    try {
      const j = await ctl.call('GET', '/' + kind + '/read?slot=' + slot, undefined, 30000);
      if (j && typeof j.data === 'string' && j.data) out[slot] = j.data;
    } catch (e) {
      log('Falha ao ler ' + kind + ' slot ' + slot + ': ' + e.message);
    }
  }
  return out;
}

async function readUserPedals(ctl, log) {
  const out = {};
  for (let n = 1; n <= 3; n++) {
    try {
      const j = await ctl.call('GET', '/upedal?n=' + n);
      if (!j || typeof j !== 'object') continue;
      const name = String(j.name || '');
      const cc = (j.cc && typeof j.cc === 'object') ? j.cc : {};
      const pc = (j.pc && typeof j.pc === 'object') ? j.pc : {};
      if (name || Object.keys(cc).length || Object.keys(pc).length) {
        out[n] = { name, cc, pc };
      }
    } catch {
      // Rota ausente = firmware anterior ao recurso. Nao ha o que salvar.
      log('Aparelhos personalizados: rota /upedal ausente neste firmware.');
      break;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Extrai o backup completo pelo canal ja aberto. Lanca em falha REAL
// (sem presets / backup truncado); perdas parciais de midia sao logadas.
export async function extractBackup(ctl, opts) {
  const log = (opts && opts.log) || (() => {});
  const onProgress = (opts && opts.onProgress) || (() => {});

  onProgress({ phase: 'presets', bytes: 0 });
  const text = await downloadPresets(ctl, onProgress);
  if (!text) throw new Error('o pedal nao devolveu o backup');

  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error('backup ilegivel (JSON invalido)'); }

  // Backup truncado parece OK e perde presets — pior que nenhum backup.
  if (obj.truncated) throw new Error('o firmware sinalizou backup truncado');
  if (!obj.presets || typeof obj.presets !== 'object') {
    throw new Error('backup sem presets');
  }

  const nPresets = Object.keys(obj.presets).length;
  log('Presets extraidos: ' + nPresets + '.');

  const images = await readMedia(ctl, 'img', onProgress, log);
  const icons  = await readMedia(ctl, 'icon', onProgress, log);
  const upedal = await readUserPedals(ctl, log);

  if (Object.keys(images).length) obj.images = images;
  if (Object.keys(icons).length)  obj.icons = icons;
  if (upedal)                     obj.user_pedals = upedal;
  if (obj.images || obj.icons || obj.user_pedals) obj.version = AUTOBACKUP_FILE_VERSION;

  log('Midia extraida: ' + Object.keys(images).length + ' imagens, ' +
      Object.keys(icons).length + ' icones.');

  return {
    obj,
    stats: {
      presets: nPresets,
      images: Object.keys(images).length,
      icons: Object.keys(icons).length,
      userPedals: upedal ? Object.keys(upedal).length : 0,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
//  INJECAO
// ════════════════════════════════════════════════════════════════════════

async function uploadMedia(ctl, kind, table, onProgress, log) {
  const keys = Object.keys(table || {});
  let ok = 0;
  const failed = [];
  for (let i = 0; i < keys.length; i++) {
    const slot = parseInt(keys[i], 10);
    const b64 = table[keys[i]];
    if (!(slot >= 0) || typeof b64 !== 'string' || !b64) continue;
    onProgress({ phase: kind === 'img' ? 'imagens' : 'icones',
                 pct: Math.round((i / keys.length) * 100) });
    try {
      const bytes = base64ToBytes(b64);
      let seq = 0, off = 0;
      do {
        const end = Math.min(off + USB_MEDIA_CHUNK, bytes.length);
        const fin = end >= bytes.length ? 1 : 0;
        await ctl.call('POST',
          '/' + kind + '/upload?slot=' + slot + '&seq=' + seq + '&fin=' + fin,
          bytesToBase64(bytes.subarray(off, end)), 20000);
        off = end; seq++;
      } while (off < bytes.length);
      ok++;
    } catch (e) {
      // Best-effort: um slot que falha (cota cheia, slot que este chip nao
      // tem) nao aborta o resto — mas ENTRA no log, porque preset apontando
      // pra imagem inexistente vira fundo preto no palco.
      failed.push(slot);
      log('Falha ao gravar ' + kind + ' slot ' + slot + ': ' + e.message);
    }
  }
  return { ok, failed };
}

// Reinjeta o backup. ORDEM OBRIGATORIA: midia e aparelhos ANTES do
// /restore, porque o /restore agenda REBOOT — o que vier depois dele se
// perde. O corpo do /restore vai sem images/icons/user_pedals: o firmware
// as ignora, e carregar payload descartado so multiplica os chunks.
export async function injectBackup(ctl, obj, opts) {
  const log = (opts && opts.log) || (() => {});
  const onProgress = (opts && opts.onProgress) || (() => {});
  const stats = { presets: 0, images: 0, icons: 0, userPedals: 0, failed: [] };

  if (obj.images) {
    const r = await uploadMedia(ctl, 'img', obj.images, onProgress, log);
    stats.images = r.ok;
    r.failed.forEach((s) => stats.failed.push('imagem ' + s));
  }
  if (obj.icons) {
    const r = await uploadMedia(ctl, 'icon', obj.icons, onProgress, log);
    stats.icons = r.ok;
    r.failed.forEach((s) => stats.failed.push('icone ' + s));
  }

  if (obj.user_pedals) {
    onProgress({ phase: 'aparelhos', pct: 0 });
    const nums = Object.keys(obj.user_pedals);
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const src = obj.user_pedals[n];
      if (!src || typeof src !== 'object') continue;
      // URLSearchParams: o firmware le os rotulos como args de formulario.
      const body = new URLSearchParams();
      body.set('name', String(src.name || ''));
      Object.keys(src.cc || {}).forEach((num) => body.set('c' + num, src.cc[num]));
      Object.keys(src.pc || {}).forEach((num) => body.set('p' + num, src.pc[num]));
      try {
        await ctl.call('POST', '/upedal?n=' + n, body.toString());
        stats.userPedals++;
      } catch (e) {
        log('Falha no aparelho USER ' + n + ': ' + e.message);
      }
    }
  }

  // ── presets (por ultimo: agenda reboot) ──
  const clone = Object.assign({}, obj);
  delete clone.images;
  delete clone.icons;
  delete clone.global_config;   // nunca injetada — ver cabecalho do arquivo
  delete clone.user_pedals;
  delete clone.boot_log;        // diagnostico gravado pelo editor; nao volta
  const body = JSON.stringify(clone);
  const total = body.length;

  let seq = 0;
  for (let off = 0; off < total; off += USB_RESTORE_CHUNK) {
    const part = body.slice(off, off + USB_RESTORE_CHUNK);
    const fin = (off + USB_RESTORE_CHUNK >= total) ? 1 : 0;
    onProgress({
      phase: 'presets',
      pct: Math.round(Math.min(off + USB_RESTORE_CHUNK, total) / total * 100),
    });
    try {
      await ctl.call('POST', '/restore?seq=' + seq + '&fin=' + fin, part, 30000);
    } catch (e) {
      // O ULTIMO chunk aplica e agenda o reboot: perder a resposta dele e
      // esperado, nao e falha. Qualquer outro chunk que falhe e falha real.
      if (fin) { log('Reinicio do pedal cortou a resposta do ultimo bloco (esperado).'); break; }
      throw e;
    }
    seq++;
    if (fin) break;
  }
  stats.presets = Object.keys(obj.presets || {}).length;
  return stats;
}

// ════════════════════════════════════════════════════════════════════════
//  PERSISTENCIA LOCAL (seguro contra F5 / fechar a aba no meio)
// ════════════════════════════════════════════════════════════════════════
//  IndexedDB e nao localStorage: um backup com midia passa facil dos 5 MB
//  de cota por origem do localStorage (S3 = ate ~2,4 MB de midia, que em
//  base64 viram ~3,2 MB).
const IDB_NAME = 'bfmidi-updater';
const IDB_STORE = 'autobackup';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun(mode, fn) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function stashBackup(obj) {
  try {
    await idbRun('readwrite', (st) => st.put({ at: Date.now(), obj }, 'last'));
    return true;
  } catch { return false; }
}

export async function loadStashedBackup() {
  try {
    const rec = await idbRun('readonly', (st) => st.get('last'));
    return rec && rec.obj ? rec : null;
  } catch { return null; }
}

export async function clearStashedBackup() {
  try { await idbRun('readwrite', (st) => st.delete('last')); } catch {}
}

// Baixa o backup como arquivo — mesmo nome/formato do editor, entao serve
// de restauracao manual se a reinjecao falhar.
export function downloadBackup(obj, prefix) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (prefix || 'bfmidi-backup') + '-' + date + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Espera a porta do APP reaparecer (VID 303A / PID 80C2) depois do flash.
// So entao o canal CDC existe pra reinjecao.
export async function waitForAppPort(vendorId, timeoutMs) {
  const vid = vendorId || 0x303a;
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    let ports = [];
    try { ports = await navigator.serial.getPorts(); } catch {}
    const match = ports.find((p) => {
      let info = {};
      try { info = p.getInfo() || {}; } catch {}
      return info.usbVendorId === vid &&
             info.usbProductId === 0x80c2 &&
             p.connected !== false;
    });
    if (match) return match;
    await sleep(250);
  }
  return null;
}
