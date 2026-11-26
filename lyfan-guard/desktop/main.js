// LyFan Guard · ventana flotante de escritorio (Electron).
// - Ventana transparente, sin marco, siempre encima, que se arrastra tomando a LyFan.
// - Inicia el servidor local (Python) como proceso hijo y lo cierra al salir.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, clipboard, nativeImage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DIR_BACKEND = path.join(RAIZ, 'backend');
const PYTHON = process.env.LYFAN_PYTHON || path.join(DIR_BACKEND, '.venv', 'Scripts', 'python.exe');
const PUERTO = Number(process.env.LYFAN_PUERTO || 8765);
const URL_BASE = `http://127.0.0.1:${PUERTO}`;
const MARGEN = 16;
let tam = { ancho: 380, alto: 520, robot: 300 };   // tamaño de la ventana según el tamaño de LyFan
const ATAJO = 'Control+Alt+L';

let vBoveda = null, ventana = null, bandeja = null, backend = null, arrastre = null, salir = false, temporizadorCursor = null;
const archivoPosicion = () => path.join(app.getPath('userData'), 'ventana.json');

// Una sola copia de LyFan a la vez
if (!app.requestSingleInstanceLock()) { app.quit(); }
else app.on('second-instance', () => mostrar());

// ----------------------------------------------------------------- servidor local
function ping() {
  return new Promise(resolver => {
    const req = http.get(`${URL_BASE}/api/salud`, { timeout: 1200 }, res => { res.resume(); resolver(res.statusCode === 200); });
    req.on('error', () => resolver(false)); req.on('timeout', () => { req.destroy(); resolver(false); });
  });
}
async function iniciarBackend() {
  if (await ping()) return true;                       // ya estaba encendido
  if (!fs.existsSync(PYTHON)) { console.error('No encuentro Python del backend en', PYTHON); return false; }
  const registro = fs.openSync(path.join(app.getPath('userData'), 'backend.log'), 'a');
  backend = spawn(PYTHON, ['-m', 'app.main'], { cwd: DIR_BACKEND, windowsHide: true, stdio: ['ignore', registro, registro] });
  backend.on('exit', () => { backend = null; });
  for (let i = 0; i < 60; i++) { if (await ping()) return true; await new Promise(r => setTimeout(r, 500)); }
  return false;
}
function detenerBackend() {
  if (backend && backend.pid) execFile('taskkill', ['/pid', String(backend.pid), '/T', '/F'], () => {});
  backend = null;
}

// ----------------------------------------------------------------- ventana
function posicionInicial() {
  try {
    const g = JSON.parse(fs.readFileSync(archivoPosicion(), 'utf8'));
    if (g.ancho >= 300 && g.alto >= 400) tam = { ancho: Math.min(900, g.ancho), alto: Math.min(1000, g.alto), robot: g.robot || 300 };
    const visible = screen.getAllDisplays().some(d => {
      const b = d.workArea; return g.x + 80 > b.x && g.x < b.x + b.width - 80 && g.y + 80 > b.y && g.y < b.y + b.height - 80;
    });
    if (visible) return { x: g.x, y: g.y };
  } catch { /* primera vez */ }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - tam.ancho - MARGEN, y: wa.y + wa.height - tam.alto - MARGEN };
}
function guardarPosicion() {
  if (!ventana) return;
  const [x, y] = ventana.getPosition();
  try { fs.writeFileSync(archivoPosicion(), JSON.stringify({ x, y, ancho: tam.ancho, alto: tam.alto, robot: tam.robot })); } catch { /* no es grave */ }
}

// Micrófono: solo para esta página local (LyFan Guard), nada más
function configurarPermisos() {
  const ses = session.defaultSession, propia = url => typeof url === 'string' && url.startsWith(URL_BASE);
  ses.setPermissionRequestHandler((wc, permiso, aceptar, detalles) => aceptar(permiso === 'media' && propia(detalles.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permiso, origen) => permiso === 'media' && propia(origen));
}

function crearVentana() {
  const { x, y } = posicionInicial();
  ventana = new BrowserWindow({
    x, y, width: tam.ancho, height: tam.alto,
    transparent: true, frame: false, hasShadow: false, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, backgroundColor: '#00000000', title: 'LyFan Guard',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  ventana.setAlwaysOnTop(true, 'floating');
  ventana.setMenuBarVisibility(false);
  ventana.loadURL(`${URL_BASE}/overlay.html`);
  ventana.once('ready-to-show', () => ventana.show());
  // si LyFan se oculta, el micrófono de manos libres se pausa solo
  ventana.on('hide', () => ventana.webContents.send('visibilidad', false));
  ventana.on('show', () => ventana.webContents.send('visibilidad', true));

  // La página solo puede navegar dentro de LyFan Guard
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_BASE)) e.preventDefault(); });

  ventana.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: 'Escribirle a LyFan', click: () => enfocarEntrada() },
      { label: 'Analizar el portapapeles', click: () => ventana.webContents.send('accion', 'analizar-portapapeles') },
      { label: 'Abrir la bóveda', click: () => abrirBoveda(null) },
      { label: 'Ventana principal', click: () => abrirPrincipal() },
      { label: 'Expresión', submenu: [['idle', 'Reposo'], ['listen', 'Escuchando'], ['curious', 'Curioso'], ['wink', 'Guiño'], ['scan', 'Analizar'], ['scanTalk', 'Analizar hablando'], ['alert', 'Alerta'], ['alertTalk', 'Alerta hablando'], ['sleep', 'Dormir'], ['happy', 'Kawaii'], ['talk', 'Hablando'], ['work', 'Trabajando'], ['workTalk', 'Trabajando hablando'], ['thinking', 'Pensando'], ['encrypt', 'Cifrar'], ['decrypt', 'Descifrar']]
        .map(([id, nombre]) => ({ label: nombre, click: () => ventana.webContents.send('accion', 'expresion:' + id) })) },
      { type: 'separator' },
      { label: 'Ocultar', click: () => ventana.hide() },
      { label: 'Salir', click: () => { salir = true; app.quit(); } },
    ]).popup({ window: ventana });
  });
  ventana.on('closed', () => { ventana = null; });
}

function mostrar() { if (!ventana) return; ventana.show(); ventana.focus(); }
function enfocarEntrada() { if (!ventana) return; mostrar(); ventana.webContents.send('enfocar-entrada'); }

// Los ojos de LyFan siguen el cursor de toda la pantalla
function seguirCursor() {
  let ultimo = [9, 9];
  temporizadorCursor = setInterval(() => {
    if (!ventana || !ventana.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = ventana.getBounds();
    const cx = b.x + b.width / 2, cy = b.y + b.height - 112 - 0.6 * tam.robot;   // centro aproximado de la cara de LyFan
    const d = Math.max(220, tam.robot * 1.1);
    const x = Math.max(-1, Math.min(1, (p.x - cx) / d)), y = Math.max(-1, Math.min(1, (p.y - cy) / d));
    if (Math.abs(x - ultimo[0]) > 0.03 || Math.abs(y - ultimo[1]) > 0.03) { ultimo = [x, y]; ventana.webContents.send('cursor', x, y); }
  }, 80);
}

// ----------------------------------------------------------------- bandeja del sistema
function crearBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  bandeja.setToolTip('LyFan Guard');
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar a LyFan', click: () => mostrar() },
    { label: 'Escribirle (Ctrl+Alt+L)', click: () => enfocarEntrada() },
    { label: 'Abrir la bóveda', click: () => abrirBoveda(null) },
    { label: 'Ventana principal', click: () => abrirPrincipal() },
    { label: 'Ocultar', click: () => ventana && ventana.hide() },
    { label: 'Abrir en el navegador', click: () => shell.openExternal(`${URL_BASE}/overlay.html`) },
    { type: 'separator' },
    { label: 'Salir', click: () => { salir = true; app.quit(); } },
  ]));
  bandeja.on('click', () => (ventana && ventana.isVisible() ? ventana.hide() : mostrar()));
}

// ----------------------------------------------------------------- comunicación con la página
ipcMain.on('arrastrar-inicio', () => {
  if (!ventana) return;
  arrastre = { pos: ventana.getPosition(), size: ventana.getSize(), cursor: screen.getCursorScreenPoint() };
});
ipcMain.on('arrastrar-mover', () => {
  if (!ventana || !arrastre) return;
  const c = screen.getCursorScreenPoint();
  // setBounds con el tamaño del inicio del arrastre evita que una ventana transparente "crezca" con pantallas de alta densidad
  ventana.setBounds({ x: Math.round(arrastre.pos[0] + c.x - arrastre.cursor.x), y: Math.round(arrastre.pos[1] + c.y - arrastre.cursor.y), width: arrastre.size[0], height: arrastre.size[1] });
});
ipcMain.on('arrastrar-fin', () => { arrastre = null; guardarPosicion(); });
// El tamaño de LyFan cambió: la ventana crece o se encoge manteniendo fija la base (hacia arriba y a los lados)
ipcMain.on('ajustar-tamano', (_e, ancho, alto, _escala, robot) => {
  if (!ventana) return;
  const f = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || a)));
  tam = { ancho: f(ancho, 300, 900), alto: f(alto, 400, 1000), robot: f(robot, 100, 600) };
  const b = ventana.getBounds();
  if (Math.abs(b.width - tam.ancho) < 2 && Math.abs(b.height - tam.alto) < 2) { guardarPosicion(); return; }
  const wa = screen.getDisplayMatching(b).workArea;
  let x = Math.round(b.x + (b.width - tam.ancho) / 2), y = Math.round(b.y + b.height - tam.alto);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - tam.ancho)); y = Math.max(wa.y, Math.min(y, wa.y + wa.height - tam.alto));
  ventana.setResizable(true);
  ventana.setBounds({ x, y, width: tam.ancho, height: tam.alto });
  ventana.setResizable(false);
  guardarPosicion();
});
ipcMain.on('ignorar-mouse', (_e, ignorar) => { if (ventana) ventana.setIgnoreMouseEvents(ignorar, { forward: true }); });
ipcMain.on('ocultar', () => ventana && ventana.hide());
ipcMain.handle('leer-portapapeles', () => clipboard.readText());


// ----------------------------------------------------------------- pantalla de la Bóveda (ventana grande, sin marco)
function abrirBoveda(tarea) {
  if (vBoveda && !vBoveda.isDestroyed()) {
    if (vBoveda.isMinimized()) vBoveda.restore(); vBoveda.show(); vBoveda.focus();
    // si la pantalla quedó vacía (no llegó a cargar los archivos), se recarga
    vBoveda.webContents.executeJavaScript("!!document.querySelector('#term .l')").then(ok => { if (!ok) vBoveda.webContents.reloadIgnoringCache(); }).catch(() => {});
    return;
  }
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  vBoveda = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, hasShadow: false, resizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#00000000', title: 'LyFan · Bóveda', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  vBoveda.setMenuBarVisibility(false);
  let hash = '';
  try { if (tarea && typeof tarea === 'object') { const t = JSON.stringify(tarea); if (t.length < 4000) hash = '#t=' + encodeURIComponent(t); } } catch { /* sin pedido */ }
  vBoveda.loadURL(`${URL_BASE}/boveda.html${hash}`, { extraHeaders: 'pragma: no-cache\n' });
  // Si la página no cargó bien (LyFan estaba reiniciándose u ocupado), se vuelve a intentar
  let reintentos = 0;
  vBoveda.webContents.on('did-fail-load', () => { if (reintentos++ < 5) setTimeout(() => { if (vBoveda && !vBoveda.isDestroyed()) vBoveda.loadURL(`${URL_BASE}/boveda.html${hash}`); }, 800); });
  vBoveda.webContents.on('unresponsive', () => { if (vBoveda && !vBoveda.isDestroyed()) vBoveda.webContents.reloadIgnoringCache(); });
  vBoveda.once('ready-to-show', () => { vBoveda.show(); vBoveda.focus(); });
  vBoveda.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  vBoveda.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_BASE)) e.preventDefault(); });
  vBoveda.on('closed', () => { vBoveda = null; });
}
ipcMain.on('abrir-boveda', (_e, tarea) => abrirBoveda(tarea));

// ----------------------------------------------------------------- ventana principal (la «casa» de LyFan)
// Mientras está abierta, la ventanita flotante se oculta: LyFan «se muda» a la ventana grande.
// La ventanita sigue funcionando por detrás (voz, micrófono, bóveda e IA) y vuelve a aparecer al cerrarla.
let vPrincipal = null;
function abrirPrincipal() {
  if (vPrincipal && !vPrincipal.isDestroyed()) { if (vPrincipal.isMinimized()) vPrincipal.restore(); vPrincipal.show(); vPrincipal.focus(); return; }
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const ancho = Math.min(1320, Math.round(wa.width * 0.86)), alto = Math.min(860, Math.round(wa.height * 0.9));
  vPrincipal = new BrowserWindow({
    x: wa.x + Math.round((wa.width - ancho) / 2), y: wa.y + Math.round((wa.height - alto) / 2), width: ancho, height: alto,
    minWidth: 900, minHeight: 600, show: false, backgroundColor: '#0a1016', title: 'LyFan Guard',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0a1016', symbolColor: '#93a7b5', height: 44 },
    icon: path.join(__dirname, 'assets', 'tray.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  vPrincipal.setMenuBarVisibility(false);
  vPrincipal.loadURL(`${URL_BASE}/principal.html`);
  vPrincipal.once('ready-to-show', () => { vPrincipal.show(); vPrincipal.focus(); if (ventana && ventana.isVisible()) ventana.hide(); });
  vPrincipal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  vPrincipal.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_BASE)) e.preventDefault(); });
  vPrincipal.on('closed', () => { vPrincipal = null; if (ventana && !salir) mostrar(); });
}
ipcMain.on('abrir-principal', () => abrirPrincipal());

// ----------------------------------------------------------------- arranque
app.whenReady().then(async () => {
  const bien = await iniciarBackend();
  if (!bien) console.error('El servidor de LyFan Guard no respondió; la ventana mostrará el aviso de conexión.');
  await session.defaultSession.clearCache();     // la interfaz siempre se carga fresca (sin versiones viejas en caché)
  configurarPermisos(); crearVentana(); crearBandeja(); seguirCursor();
  globalShortcut.register(ATAJO, () => (ventana && ventana.isVisible() && ventana.isFocused() ? ventana.hide() : enfocarEntrada()));

  // Modo prueba: guarda una captura de la ventana (con su transparencia) y cierra
  if (process.env.LYFAN_CAPTURA) {
    setTimeout(async () => {
      try {
        if (process.env.LYFAN_ESCALA) {      // prueba: abre con otro tamaño de LyFan
          await ventana.webContents.executeJavaScript(`localStorage.setItem('lyfan-tamano', '${Number(process.env.LYFAN_ESCALA)}')`);
          ventana.webContents.reload(); await new Promise(r => setTimeout(r, 5000));
        }
        const img = await ventana.webContents.capturePage();
        fs.writeFileSync(process.env.LYFAN_CAPTURA, img.toPNG());
        // Diagnóstico del micrófono dentro de la ventana (permiso y dispositivos)
        const mic = await ventana.webContents.executeJavaScript(`(async () => {
          try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').length;
                let acceso = 'sin probar';
                try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); acceso = 'ok'; }
                catch (e) { acceso = e.name; }
                return { dispositivos: ds, acceso, voz: typeof window.LyFanVoz, sintesis: typeof speechSynthesis }; }
          catch (e) { return { error: String(e) }; } })()`);
        if (process.env.LYFAN_BOVEDA_CAPTURA) {      // prueba: abre la pantalla de la bóveda y la captura
          abrirBoveda({ accion: 'mostrar', filtro: 'todos', id: 'prueba' });
          await new Promise(r => setTimeout(r, 4500));
          if (vBoveda) {
            fs.writeFileSync(process.env.LYFAN_BOVEDA_CAPTURA, (await vBoveda.webContents.capturePage()).toPNG());
            fs.writeFileSync(process.env.LYFAN_BOVEDA_CAPTURA + '.json', JSON.stringify({ bounds: vBoveda.getBounds(), transparente: true }));
          }
        }
        if (process.env.LYFAN_PRINCIPAL_CAPTURA) {   // prueba: abre la ventana principal y la captura
          abrirPrincipal();
          await new Promise(r => setTimeout(r, 6000));
          if (vPrincipal) {
            fs.writeFileSync(process.env.LYFAN_PRINCIPAL_CAPTURA, (await vPrincipal.webContents.capturePage()).toPNG());
            fs.writeFileSync(process.env.LYFAN_PRINCIPAL_CAPTURA + '.json', JSON.stringify({ bounds: vPrincipal.getBounds(), robotVisible: ventana.isVisible(),
              conectado: await vPrincipal.webContents.executeJavaScript("document.querySelector('.pet-phrase').textContent") }));
          }
        }
        const info = { transparente: true, siempreArriba: ventana.isAlwaysOnTop(), bounds: ventana.getBounds(), mic };
        fs.writeFileSync(process.env.LYFAN_CAPTURA + '.json', JSON.stringify(info));
      } catch (e) { console.error(e); try { fs.writeFileSync((process.env.LYFAN_BOVEDA_CAPTURA || process.env.LYFAN_CAPTURA) + '.err', String(e && e.stack || e)); } catch { /* nada */ } }
      salir = true; app.quit();
    }, Number(process.env.LYFAN_CAPTURA_MS || 7000));
  }
});
app.on('window-all-closed', () => { if (salir) app.quit(); });
app.on('before-quit', () => { salir = true; clearInterval(temporizadorCursor); globalShortcut.unregisterAll(); guardarPosicion(); });
app.on('will-quit', detenerBackend);
// Antes de cerrar, LyFan le pide a Ollama que suelte el modelo: así no queda ocupando la tarjeta gráfica.
let modeloLiberado = false;
app.on('before-quit', e => {
  if (modeloLiberado) return;
  e.preventDefault(); modeloLiberado = true;
  const fin = () => app.quit();
  const t = setTimeout(fin, 2500);
  fetch(`${URL_BASE}/api/liberar`, { method: 'POST' }).catch(() => {}).finally(() => { clearTimeout(t); fin(); });
});
