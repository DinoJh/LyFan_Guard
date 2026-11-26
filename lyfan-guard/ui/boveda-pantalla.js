/* LyFan Guard · pantalla de la Bóveda (estilo consola).
   Recibe pedidos de LyFan («cifra trabajo», «descifra trabajo», «muéstrame los cifrados», «analiza el .bat»)
   y también se puede usar a mano. La contraseña se escribe solo en la ventana central de esta pantalla. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('lyfan-boveda') : null;
  let est = null, filtro = 'todos', busqueda = '', seleccion = null, ultimoTarea = null, cuenta = 0;
  const animar = new Set();
  let ocupado = false;

  const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const hora = () => new Date().toTimeString().slice(0, 8);
  const sinLyfan = n => n.replace(/\.lyfan$/, '');
  const extDe = n => { const m = sinLyfan(n).match(/\.([A-Za-z0-9]{1,5})$/); return m ? m[1] : 'ARCH'; };
  const listo = () => ['Listo,', 'Hecho,', 'Ya está,', 'Terminé,'][Math.floor(Math.random() * 4)];
  const avisarLyFan = (texto, tarea, nivel) => { if (canal) canal.postMessage({ tipo: 'resultado', texto, tarea, nivel }); };
  const avisarPose = pose => { if (canal) canal.postMessage({ tipo: 'pose', pose }); };

  async function api(ruta, cuerpo) {
    const r = await fetch('/api/boveda' + ruta, cuerpo === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No pude completar la acción.'); e.codigo = r.status; throw e; }
    return j;
  }

  // ================================================================== terminal
  const term = $('term');
  function log(tipo, texto, { cursor = false } = {}) {
    const d = document.createElement('div'); d.className = 'l ' + tipo + (cursor ? ' cursor' : '');
    const h = document.createElement('span'); h.className = 'h'; h.textContent = hora();
    d.append(h, document.createTextNode(texto));
    term.querySelectorAll('.cursor').forEach(x => x.classList.remove('cursor'));
    term.append(d);
    while (term.children.length > 200) term.firstChild.remove();
    term.scrollTop = term.scrollHeight;
    return d;
  }
  const barra = n => { const k = Math.round(n / 10); return '█'.repeat(k) + '░'.repeat(10 - k); };

  function scramble(el, final, ms = 750) {
    const abc = '01ABCDEF#$%&*+<>/', t0 = performance.now();
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      el.textContent = [...final].map((c, i) => (i < p * final.length || c === ' ' || c === '.') ? c : abc[(Math.random() * abc.length) | 0]).join('');
      if (p >= 1) clearInterval(id);
    }, 40);
  }

  // ================================================================== pintar
  function pintar(e) {
    est = e; cuenta = e.bloquea_en_s || 0;
    const chip = $('chip-estado');
    if (!e.creada) { chip.dataset.e = 'sin'; chip.textContent = '● SIN CREAR'; }
    else if (e.bloqueada) { chip.dataset.e = 'bloqueada'; chip.textContent = '● BLOQUEADA'; }
    else { chip.dataset.e = 'abierta'; chip.textContent = '● ABIERTA'; }
    $('bt-bloquear').disabled = !e.creada || e.bloqueada;
    const todos = e.archivos || [];
    $('n-todos').textContent = todos.length;
    $('n-cifrados').textContent = todos.filter(a => a.cifrado).length;
    $('n-claro').textContent = todos.filter(a => !a.cifrado).length;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('activo', t.dataset.f === filtro));
    pintarLista();
    pintarTiempo();
  }
  function pintarTiempo() {
    $('chip-tiempo').textContent = est && est.creada && !est.bloqueada && cuenta > 0 ? `autobloqueo en ${Math.floor(cuenta / 60)}:${String(cuenta % 60).padStart(2, '0')}` : '';
  }
  setInterval(() => { if (cuenta > 0) { cuenta--; pintarTiempo(); if (cuenta === 0) refrescar(); } }, 1000);

  function boton(texto, clase, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bt peq ' + clase; b.textContent = texto;
    b.addEventListener('click', ev => { ev.stopPropagation(); fn(); }); return b;
  }
  function pintarLista() {
    const ul = $('lista'); ul.textContent = '';
    const q = busqueda.trim().toLowerCase();
    const arch = (est.archivos || []).filter(a => (filtro === 'todos' || (filtro === 'cifrados') === a.cifrado) && (!q || a.nombre.toLowerCase().includes(q)));
    if (!arch.length) {
      const li = document.createElement('li'); li.className = 'vacio';
      li.textContent = !est.creada ? 'Aún no hay bóveda. Cree su contraseña maestra para empezar.'
        : (est.archivos || []).length ? 'No hay archivos con ese filtro.' : 'La bóveda está vacía. Arrastre archivos aquí o use «+ AGREGAR».';
      ul.append(li); return;
    }
    for (const a of arch) {
      const li = document.createElement('li'); li.className = 'fila' + (a.nombre === seleccion ? ' sel' : ''); li.dataset.c = a.cifrado ? '1' : '0';
      const ext = document.createElement('div'); ext.className = 'ext'; ext.textContent = extDe(a.nombre);
      const nom = document.createElement('div'); nom.className = 'nom';
      const b = document.createElement('b'); b.textContent = sinLyfan(a.nombre);
      const pq = document.createElement('small'); pq.textContent = (a.cifrado ? `${a.nombre} · ` : '') + fmt(a.bytes);
      nom.append(b, pq);
      const st = document.createElement('span'); st.className = 'estado ' + (a.cifrado ? 'cif' : 'cla'); st.textContent = a.cifrado ? '🔒 CIFRADO' : '🔓 EN CLARO';
      const ac = document.createElement('div'); ac.className = 'acciones';
      if (a.cifrado) ac.append(boton('DESCIFRAR', 'cian', () => descifrar([a.nombre])));
      else {
        ac.append(boton('CIFRAR', 'cian', () => cifrar([a.nombre])), boton('ANALIZAR', 'ambar', () => analizar([a.nombre])), boton('VER', '', () => ver(a.nombre)));
        if (marcados.has(a.nombre)) ac.append(boton('CUARENTENA', 'rojo', () => aislar(a.nombre)));   // solo si el análisis lo marcó
      }
      li.append(ext, nom, st, ac);
      li.addEventListener('click', () => ver(a.nombre, true));
      if (animar.has(a.nombre)) { animar.delete(a.nombre); li.classList.add('nuevo'); scramble(b, sinLyfan(a.nombre)); }
      ul.append(li);
    }
  }

  async function refrescar() { try { pintar(await api('')); } catch { log('err', 'No pude consultar la bóveda.'); } }

  // ================================================================== vista previa
  async function ver(nombre, silencio = false) {
    seleccion = nombre; pintarLista();
    const a = (est.archivos || []).find(x => x.nombre === nombre); if (!a) return;
    $('vista').hidden = false; $('vista-nombre').textContent = sinLyfan(nombre);
    const pre = $('vista-texto');
    if (a.cifrado) { pre.textContent = '[ CONTENIDO CIFRADO ]\n' + Array.from({ length: 5 }, () => Array.from({ length: 28 }, () => ((Math.random() * 256) | 0).toString(16).padStart(2, '0')).join(' ')).join('\n') + '\n\nDescifre el archivo con su contraseña para verlo.'; return; }
    try {
      const r = await api('/leer', { nombre });
      pre.textContent = r.legible ? r.texto + (r.truncado ? '\n\n… (vista parcial)' : '') : 'Vista previa disponible solo para archivos de texto y scripts.';
      if (!silencio) log('info', `> VER ${nombre}`);
    } catch (e) { pre.textContent = e.message; }
  }

  // ================================================================== ventana central de la contraseña
  let cerrarVentana = null;
  const puntos = () => { const n = $('m-clave').value.length; $('m-puntos').textContent = '●'.repeat(Math.min(n, 26)) + (n > 26 ? '…' : ''); };
  $('m-clave').addEventListener('input', puntos);
  $('m-ver').addEventListener('click', () => {
    const ver = $('m-clave').type === 'password';
    $('m-clave').type = $('m-repite').type = ver ? 'text' : 'password'; $('m-ver').textContent = ver ? 'OCULTAR' : 'VER';
  });
  function ventana({ titulo, texto, repetir = false, boton: textoBoton = 'ACEPTAR', accion }) {
    if (cerrarVentana) cerrarVentana(false);
    return new Promise(resolver => {
      const m = $('modal'), clave = $('m-clave'), rep = $('m-repite'), err = $('m-error'), ok = $('m-ok'), caja = $('m-form');
      $('m-titulo').textContent = titulo; $('m-texto').textContent = texto; ok.textContent = textoBoton; ok.disabled = false;
      clave.value = rep.value = ''; clave.type = rep.type = 'password'; $('m-ver').textContent = 'VER'; err.textContent = ''; rep.hidden = !repetir; puntos();
      clave.autocomplete = repetir ? 'new-password' : 'current-password';
      m.hidden = false; setTimeout(() => clave.focus(), 40);
      let enCurso = false;
      const cerrar = bien => {
        m.hidden = true; clave.value = rep.value = ''; puntos(); cerrarVentana = null;
        $('m-form').onsubmit = null; $('m-cancelar').onclick = null; document.removeEventListener('keydown', tecla, true); resolver(bien);
      };
      const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cerrar(false); } };
      document.addEventListener('keydown', tecla, true);
      cerrarVentana = cerrar;
      $('m-cancelar').onclick = () => cerrar(false);
      const mal = msg => { err.textContent = msg; caja.classList.remove('sacude'); void caja.offsetWidth; caja.classList.add('sacude'); };
      $('m-form').onsubmit = async ev => {
        ev.preventDefault(); if (enCurso) return;
        err.textContent = '';
        if (repetir) {
          if (clave.value.length < 8) { mal('Debe tener al menos 8 caracteres.'); return clave.focus(); }
          if (clave.value !== rep.value) { mal('Las dos contraseñas no coinciden.'); return rep.focus(); }
        } else if (!clave.value) return clave.focus();
        enCurso = true; ok.disabled = true; const previo = ok.textContent; ok.textContent = 'VERIFICANDO…';
        try { await accion(clave.value); cerrar(true); }
        catch (e) { mal(e.message || 'No pude completar la acción.'); clave.select(); ok.textContent = previo; ok.disabled = false; enCurso = false; }
      };
    });
  }

  async function crearBoveda() {
    const ok = await ventana({
      titulo: 'Cree su contraseña maestra',
      texto: 'Con ella LyFan cifrará y descifrará sus archivos. Si la olvida, nadie podrá recuperarlos.',
      repetir: true, boton: 'CREAR BÓVEDA',
      accion: async c => { pintar(await api('/crear', { clave: c })); },
    });
    if (ok) { log('ok', '✔ Bóveda creada. Guarde bien su contraseña: no se puede recuperar.'); avisarLyFan('Su bóveda está lista, señor. Guarde bien su contraseña.'); }
    else log('aviso', 'Creación cancelada.');
    return ok;
  }
  async function pedirDesbloqueo() {
    const ok = await ventana({
      titulo: 'Desbloquear la bóveda', texto: 'Escriba su contraseña maestra para continuar.', boton: 'DESBLOQUEAR',
      accion: async c => { pintar(await api('/desbloquear', { clave: c })); },
    });
    log(ok ? 'ok' : 'aviso', ok ? '✔ Bóveda desbloqueada.' : 'Desbloqueo cancelado.');
    return ok;
  }

  // Una sola contraseña para toda la bóveda. Cambiarla vuelve a cifrar cada archivo con la nueva.
  async function cambiarClave() {
    if (ocupado) return;
    if (!est.creada) { await crearBoveda(); return; }
    ocupado = true;
    try {
      let actual = '';
      const paso1 = await ventana({
        titulo: 'Cambiar contraseña · 1 de 2', texto: 'Escriba su contraseña ACTUAL. Su bóveda usa una sola contraseña para todos los archivos.', boton: 'CONTINUAR',
        accion: async c => { pintar(await api('/desbloquear', { clave: c })); actual = c; },
      });
      if (!paso1) { log('aviso', 'Cambio de contraseña cancelado.'); return; }
      let res = null;
      log('info', '> CAMBIANDO CONTRASEÑA — se volverán a cifrar los archivos…', { cursor: true });
      const paso2 = await ventana({
        titulo: 'Cambiar contraseña · 2 de 2', texto: 'Escriba la NUEVA contraseña dos veces. Desde ahora será la única que abre su bóveda.', repetir: true, boton: 'CAMBIAR',
        accion: async c => { res = await api('/cambiar-clave', { actual, nueva: c }); pintar(res); },
      });
      actual = '';
      if (!paso2) { log('aviso', 'Cambio de contraseña cancelado: sigue valiendo la anterior.'); return; }
      log('ok', `✔ Contraseña cambiada. ${res.recifrados} archivo(s) cifrados de nuevo con la nueva contraseña.`);
      avisarLyFan(listo() + ' su bóveda ya usa la nueva contraseña. La anterior dejó de servir.', 'encrypt', 'tranquilo');
    } finally { ocupado = false; }
  }

  // ================================================================== acciones
  async function cifrar(nombres) {
    if (ocupado) return; ocupado = true; avisarPose('encrypt');
    try {
      if (!est.creada) { if (!(await crearBoveda())) return; }
      if (est.bloqueada && !(await pedirDesbloqueo())) { avisarLyFan('No se cifró nada, señor.', 'encrypt'); return; }
      const hechos = [];
      for (const n of nombres) {
        log('info', `> CIFRANDO ${n} …`, { cursor: true });
        try {
          const r = await api('/cifrar', { nombre: n, borrar_original: true });
          animar.add(r.cifrado); pintar(r); hechos.push(n);
          log('ok', `✔ ${n} → ${r.cifrado}  [AES-256-GCM] · original eliminado de la carpeta`);
        } catch (e) { log('err', `✖ ${n}: ${e.message}`); }
      }
      avisarLyFan(hechos.length ? `${listo()} cifré ${hechos.length === 1 ? hechos[0] : hechos.length + ' archivos'}, señor.` : 'No pude cifrar ese archivo, señor.', 'encrypt', hechos.length ? 'tranquilo' : 'alerta');
    } finally { ocupado = false; avisarPose(null); }
  }

  async function descifrar(nombres) {
    if (ocupado) return; ocupado = true; avisarPose('decrypt');
    try {
      if (!est.creada) { log('aviso', 'Aún no hay bóveda.'); return; }
      const cuales = nombres.length === 1 ? sinLyfan(nombres[0]) : `${nombres.length} archivos`;
      log('info', `> DESCIFRAR ${cuales} — esperando contraseña…`, { cursor: true });
      let res = null;
      const ok = await ventana({
        titulo: 'Descifrar', texto: `Escriba su contraseña maestra para descifrar ${cuales}.`, boton: 'DESCIFRAR',
        accion: async c => { res = await api('/descifrar', { nombres, clave: c }); pintar(res); },
      });
      if (!ok) { log('aviso', 'Cancelado: no se descifró nada.'); avisarLyFan('Entendido, no se descifró nada.', 'decrypt'); return; }
      for (const h of res.descifrados || []) { animar.add(h); log('ok', `✔ ${h} descifrado y devuelto a la carpeta`); }
      for (const f of res.fallos || []) log('err', `✖ ${f}`);
      pintar(await api(''));
      const bien = (res.descifrados || []).length;
      avisarLyFan(bien ? `${listo()} descifré ${res.descifrados.length === 1 ? res.descifrados[0] : res.descifrados.length + ' archivos'}, señor.` : 'No pude descifrar el archivo, señor.', 'decrypt', bien ? 'tranquilo' : 'alerta');
    } finally { ocupado = false; avisarPose(null); }
  }

  // ================================================================== cuarentena
  const marcados = new Set();                                   // archivos que el análisis marcó como sospechosos
  async function aislar(nombre) {
    log('info', `> CUARENTENA ${nombre} …`, { cursor: true });
    try {
      const r = await fetch('/api/cuarentena/poner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No pude aislarlo.');
      marcados.delete(nombre); await refrescar();
      log('ok', `✔ ${nombre} aislado en cuarentena: ya no puede abrirse ni ejecutarse.`);
      avisarLyFan(`${listo()} puse ${nombre} en cuarentena. Si fue una falsa alarma, dígame «saca ${nombre.replace(/\.[^.]+$/, '')} de cuarentena».`, 'scan', 'tranquilo');
    } catch (e) { log('err', `✖ ${nombre}: ${e.message}`); }
  }

  function mostrarAnalisis(r) {
    log('info', `> ANÁLISIS DE ${r.nombre}  ·  ${r.motor || 'LyFan Antivirus'}`);
    const g = r.riesgo || (r.estafa && r.estafa.nivel !== 'tranquilo' ? r.estafa : null);
    if (g) {
      const tipo = g.nivel === 'peligro' ? 'err' : g.nivel === 'alerta' ? 'aviso' : 'ok';
      log(tipo, `RIESGO ${barra(g.puntaje)} ${g.puntaje}/100 [${g.nivel.toUpperCase()}]`);
      for (const x of g.razones || []) log(tipo === 'ok' ? 'tenue' : tipo, `  ! ${x}`);
      if (g.deteccion) log(tipo, `  ☣ DETECCIÓN: ${g.deteccion}`);
      if (g.accion) log('info', `  » ${g.accion}`);
      if (g.nivel !== 'tranquilo') { marcados.add(r.nombre); pintarLista(); log('aviso', `  ⚑ Puede aislarlo con el botón CUARENTENA o diciendo «pon ${r.nombre} en cuarentena».`); }
    } else log('ok', 'RIESGO ' + barra(0) + ' 0/100 [TRANQUILO] — sin señales de problema');
    if (r.sensibles && r.sensibles.length) log('aviso', '  ⚑ Datos sensibles: ' + r.sensibles.join('; ') + '. Le recomiendo cifrarlo.');
    if (r.sha256) log('tenue', '  SHA-256 ' + r.sha256);
    if (r.mensaje) log('tenue', '  ' + r.mensaje);
  }
  function resumenAnalisis(r) {
    const g = r.riesgo || (r.estafa && r.estafa.nivel !== 'tranquilo' ? r.estafa : null);
    const sens = r.sensibles && r.sensibles.length ? ' Contiene ' + r.sensibles.join(' y ') + '; le recomiendo cifrarlo.' : '';
    if (!g || g.nivel === 'tranquilo') return `Revisé ${r.nombre}, señor, y no veo señales de peligro.${sens}`;
    const nivel = g.nivel === 'peligro' ? 'es muy sospechoso, no lo ejecute' : 'tiene señales sospechosas, tenga cuidado';
    const det = g.deteccion ? ` Lo detecté como ${g.deteccion.replace(' (heurístico)', '')}.` : '';
    return `Revisé ${r.nombre}: ${nivel}.${det} ${(g.razones || []).slice(0, 2).join('. ')}.${sens} ¿Lo pongo en cuarentena?`;
  }
  function nivelAnalisis(r) {
    const g = r.riesgo || (r.estafa && r.estafa.nivel !== 'tranquilo' ? r.estafa : null);
    return g && g.nivel !== 'tranquilo' ? g.nivel : 'tranquilo';
  }
  async function analizar(nombres) {
    avisarPose('scan');
    try {
      for (const n of nombres) {
        log('info', `> ANALIZANDO ${n} …`, { cursor: true });
        try { const r = await api('/analizar', { nombre: n }); mostrarAnalisis(r); avisarLyFan(resumenAnalisis(r), 'scan', nivelAnalisis(r)); }
        catch (e) { log('err', `✖ ${n}: ${e.message}`); avisarLyFan('No pude analizar ese archivo, señor.', 'scan', 'alerta'); }
      }
    } finally { avisarPose(null); }
  }

  // ================================================================== pedidos de LyFan
  function tarea(t) {
    if (!t) return;
    if (t.id) { if (t.id === ultimoTarea) return; ultimoTarea = t.id; }
    window.focus();
    switch (t.accion) {
      case 'mostrar':
        filtro = ['todos', 'cifrados', 'claro'].includes(t.filtro) ? t.filtro : 'todos'; busqueda = ''; $('buscar').value = '';
        pintar(est); log('info', `> LISTAR ${filtro === 'cifrados' ? 'ARCHIVOS CIFRADOS' : filtro === 'claro' ? 'ARCHIVOS EN CLARO' : 'TODOS LOS ARCHIVOS'}`);
        break;
      case 'crear': if (!est.creada) crearBoveda().then(ok => { if (ok && t.reintentar && canal) canal.postMessage({ tipo: 'reintentar', texto: t.reintentar }); }); break;
      case 'desbloquear': if (est.bloqueada) pedirDesbloqueo(); break;
      case 'cambiar': cambiarClave(); break;
      case 'cuarentena': if (t.nombres && t.nombres[0]) aislar(t.nombres[0]); break;
      case 'cifrar': cifrar(t.nombres || []); break;
      case 'descifrar': descifrar(t.nombres || []); break;
      case 'analizar': analizar(t.nombres || []); break;
      case 'ver': if (t.nombres && t.nombres[0]) ver(t.nombres[0]); break;
      default: break;
    }
  }
  const cola = [];
  if (canal) canal.onmessage = ev => { if (ev.data && ev.data.tipo === 'tarea') { const t = { ...ev.data.tarea, id: ev.data.id }; if (est) tarea(t); else cola.push(t); } };

  // ================================================================== controles
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { filtro = t.dataset.f; pintar(est); }));
  $('buscar').addEventListener('input', e => { busqueda = e.target.value; pintarLista(); });
  $('bt-clave').addEventListener('click', () => cambiarClave());
  $('bt-bloquear').addEventListener('click', async () => { try { pintar(await api('/bloquear', {})); log('aviso', '🔒 Bóveda bloqueada.'); } catch (e) { log('err', e.message); } });
  $('bt-carpeta').addEventListener('click', () => api('/abrir-carpeta', {}).then(() => log('info', '> Carpeta abierta en el Explorador.')).catch(e => log('err', e.message)));
  const cerrar = () => { if (canal) canal.postMessage({ tipo: 'cerrada' }); window.close(); };
  $('bt-cerrar').addEventListener('click', cerrar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').hidden) cerrar(); });

  // subir archivos (arrastrar y soltar o elegir)
  async function subir(archivos) {
    if (!est.creada && !(await crearBoveda())) return;
    let ok = 0;
    for (const f of archivos) {
      log('info', `> GUARDANDO ${f.name} (${fmt(f.size)}) …`, { cursor: true });
      try {
        const r = await fetch('/api/boveda/subir?nombre=' + encodeURIComponent(f.name), { method: 'POST', body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No pude guardar el archivo.');
        animar.add(j.nombre); pintar(j); ok++; log('ok', `✔ ${j.nombre} guardado en la bóveda (en claro). Pulse CIFRAR para protegerlo.`);
      } catch (e) { log('err', `✖ ${f.name}: ${e.message}`); }
    }
    if (ok) avisarLyFan(`Guardé ${ok === 1 ? 'el archivo' : 'los archivos'} en su bóveda, señor. ¿Lo${ok === 1 ? '' : 's'} cifro?`);
  }
  $('bt-agregar').addEventListener('click', () => $('archivo').click());
  $('archivo').addEventListener('change', e => { const a = [...e.target.files]; e.target.value = ''; if (a.length) subir(a); });
  const traeArchivos = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  let contador = 0;
  document.addEventListener('dragenter', e => { if (traeArchivos(e)) { contador++; document.body.classList.add('arrastrando'); e.preventDefault(); } });
  document.addEventListener('dragover', e => { if (traeArchivos(e)) e.preventDefault(); });
  document.addEventListener('dragleave', e => { if (traeArchivos(e) && --contador <= 0) { contador = 0; document.body.classList.remove('arrastrando'); } });
  document.addEventListener('drop', e => {
    if (!traeArchivos(e)) return; e.preventDefault(); contador = 0; document.body.classList.remove('arrastrando');
    const a = [...e.dataTransfer.files]; if (a.length) subir(a);
  });

  // ================================================================== lluvia de caracteres (fondo)
  (() => {
    const cv = $('lluvia'), cx = cv.getContext('2d'); if (!cx) return;
    const glifos = '01アイウエオカキクケコサシスセソ<>{}[]/\\#$%&*+=ABCDEF';
    let cols = 0, gotas = [];
    const medir = () => { cv.width = innerWidth; cv.height = innerHeight; cols = Math.ceil(cv.width / 16); gotas = Array.from({ length: cols }, () => Math.random() * -50); };
    addEventListener('resize', medir); medir();
    setInterval(() => {
      if (document.hidden) return;
      cx.fillStyle = 'rgba(2, 9, 7, .14)'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.font = '14px monospace'; cx.fillStyle = '#35ff8c';
      for (let i = 0; i < cols; i++) {
        if (gotas[i] > 0) cx.fillText(glifos[(Math.random() * glifos.length) | 0], i * 16, gotas[i] * 16);
        if (gotas[i] * 16 > cv.height && Math.random() > .975) gotas[i] = 0;
        gotas[i]++;
      }
    }, 55);
  })();

  // ================================================================== arranque
  (async () => {
    log('info', 'LYFAN GUARD // BÓVEDA v1');
    log('tenue', 'módulo de cifrado AES-256-GCM · clave derivada con scrypt · todo se hace en este equipo');
    // Si LyFan está ocupado justo al abrir, se reintenta en vez de quedarse con la pantalla vacía
    for (let intento = 1; ; intento++) {
      try { pintar(await api('')); break; }
      catch {
        if (intento >= 8) { log('err', 'No pude conectarme con LyFan. ¿Está encendido?'); return; }
        if (intento === 1) log('aviso', 'Conectando con LyFan…');
        await new Promise(r => setTimeout(r, 700 * intento));
      }
    }
    log('tenue', 'carpeta: Documentos / ' + String(est.carpeta).split(/[\\/]/).pop());
    log(est.creada ? (est.bloqueada ? 'aviso' : 'ok') : 'info', est.creada ? (est.bloqueada ? 'estado: BLOQUEADA — se pedirá su contraseña al cifrar o descifrar' : 'estado: ABIERTA') : 'estado: aún no hay bóveda');
    log('ok', 'listo. Diga a LyFan qué desea hacer, o use los botones.', { cursor: true });
    try { const h = location.hash.match(/^#t=(.+)$/); if (h) tarea(JSON.parse(decodeURIComponent(h[1]))); else if (!est.creada) crearBoveda(); } catch { /* sin pedido */ }
    cola.splice(0).forEach(tarea);
    if (canal) canal.postMessage({ tipo: 'abierta' });
    setInterval(() => { if (!ocupado) refrescar(); }, 20000);
  })();
})();
