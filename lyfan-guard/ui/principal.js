/* LyFan Guard · ventana principal.
   LyFan sigue «viviendo» en su ventanita (overlay.html): ahí están su voz, su micrófono, la bóveda y el chat con la IA.
   Esta ventana es su casa grande: muestra todo lo que pasa y le pide cosas por el canal 'lyfan-app'. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('lyfan-app') : null;
  const enviarALyFan = m => { if (canal) canal.postMessage(m); };
  const root = $('lyfan-unified');

  let historial = [], ocupado = false, conectado = false;
  const stats = { mensajes: 0, analisis: 0, alertas: 0 };
  const hora = t => new Date(t || Date.now()).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

  // ---------------------------------------------------------------- saludo según la hora
  const h = new Date().getHours();
  $('saludo').textContent = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';

  // ---------------------------------------------------------------- navegación
  function ir(v) {
    document.querySelectorAll('.item').forEach(b => b.classList.toggle('activo', b.dataset.v === v));
    document.querySelectorAll('.vista').forEach(s => s.classList.toggle('activa', s.id === 'v-' + v));
    if (v === 'boveda') cargarBoveda();
    if (v === 'actividad') pintarActividad();
    if (v === 'inicio') setTimeout(() => $('entrada').focus(), 50);
  }
  document.querySelectorAll('.item').forEach(b => b.addEventListener('click', () => ir(b.dataset.v)));
  document.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)));

  // ---------------------------------------------------------------- LyFan (la mascota imita a la de la ventanita)
  const NOMBRES_POSE = {
    idle: 'En reposo', listen: 'Escuchando', curious: 'Curioso', wink: 'Todo en orden', scan: 'Analizando', scanTalk: 'Analizando',
    alert: 'Alerta', alertTalk: 'Alerta', sleep: 'Descansando', happy: 'Contento', talk: 'Hablando', work: 'Trabajando',
    workTalk: 'Trabajando', encrypt: 'Cifrando', decrypt: 'Descifrando',
  };
  function ponerPose(p) {
    if (!p) return;
    const texto = document.querySelector('.pet-phrase').textContent;
    if (window.LyFan && window.LyFan.pose !== p) { window.LyFan.setPose(p); window.LyFan.say(texto); }
    const chip = $('chip-pose');
    chip.querySelector('span').textContent = NOMBRES_POSE[p] || 'En reposo';
    chip.dataset.t = p.startsWith('alert') ? 'alerta' : p === 'listen' ? 'escucha' : '';
  }
  function burbuja(t) { if (window.LyFan) window.LyFan.say(t); else document.querySelector('.pet-phrase').textContent = t; }
  function nivel(n) { if (n) root.dataset.nivel = n; else delete root.dataset.nivel; }
  // Un clic en LyFan es una caricia (la ventanita responde con corazones)
  document.querySelector('.pet-hit').addEventListener('click', () => enviarALyFan({ tipo: 'caricia' }));

  // ---------------------------------------------------------------- conversación
  const caja = $('mensajes');
  let globoEscribiendo = null;
  function pintarMensajes() {
    caja.textContent = '';
    if (!historial.length) {
      const v = document.createElement('div'); v.className = 'vacio';
      v.innerHTML = '<b>Aún no hemos conversado</b>Escríbale o háblele a LyFan. Puede preguntarle por un enlace, un mensaje raro o pedirle que cifre un archivo.';
      caja.append(v); return;
    }
    for (const m of historial) caja.append(globo(m));
    caja.scrollTop = caja.scrollHeight;
  }
  function globo(m) {
    const d = document.createElement('div'); d.className = 'msg ' + m.rol;
    d.textContent = m.texto;
    const t = document.createElement('time'); t.textContent = hora(m.hora); d.append(t);
    return d;
  }
  function escribiendo(si) {
    if (si && !globoEscribiendo) {
      globoEscribiendo = document.createElement('div'); globoEscribiendo.className = 'msg lyfan escribiendo';
      globoEscribiendo.innerHTML = '<span class="puntos-esc"><span></span><span></span><span></span></span>';
      caja.append(globoEscribiendo); caja.scrollTop = caja.scrollHeight;
    } else if (!si && globoEscribiendo) { globoEscribiendo.remove(); globoEscribiendo = null; }
  }
  function agregar(m) {
    historial.push(m);
    if (caja.querySelector('.vacio')) caja.textContent = '';
    const g = globo(m); if (m.rol === 'lyfan' && root.dataset.nivel && root.dataset.nivel !== 'tranquilo') g.classList.add('alerta');
    if (globoEscribiendo) caja.insertBefore(g, globoEscribiendo); else caja.append(g);
    caja.scrollTop = caja.scrollHeight;
    if (m.rol === 'usuario') stats.mensajes++;
  }

  const entrada = $('entrada');
  function ajustar() { entrada.style.height = 'auto'; entrada.style.height = Math.min(120, entrada.scrollHeight) + 'px'; }
  entrada.addEventListener('input', ajustar);
  entrada.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });
  $('form').addEventListener('submit', e => {
    e.preventDefault();
    const t = entrada.value.trim(); if (!t || ocupado) return;
    if (!conectado) { burbuja('No encuentro a LyFan. Verifique que LyFan Guard esté abierto.'); return; }
    enviarALyFan({ tipo: 'enviar', texto: t }); entrada.value = ''; ajustar();
  });
  document.querySelectorAll('.sug').forEach(b => b.addEventListener('click', () => { entrada.value = b.textContent; ajustar(); entrada.focus(); }));
  $('bt-mic').addEventListener('click', () => enviarALyFan({ tipo: 'mic' }));
  $('atajo-mic').addEventListener('click', () => enviarALyFan({ tipo: 'mic' }));
  $('bt-voz').addEventListener('click', () => enviarALyFan({ tipo: 'voz' }));
  function pintarMic(estado) {
    for (const b of [$('bt-mic'), $('atajo-mic')]) b.dataset.e = estado || 'apagado';
    $('atajo-mic').classList.toggle('activo', estado === 'voz' || estado === 'procesando');
  }

  // ---------------------------------------------------------------- analizar
  $('a-analizar').addEventListener('click', () => {
    const t = $('a-texto').value.trim();
    if (!t) { $('a-texto').focus(); return; }
    if (ocupado) return;
    $('a-analizar').disabled = true; $('a-analizar').textContent = 'Analizando…';
    enviarALyFan({ tipo: 'enviar', texto: t.slice(0, 4000), analizar: true });
  });
  $('a-pegar').addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) $('a-texto').value = t; } catch { $('a-texto').focus(); }
  });
  const TITULOS = { tranquilo: 'Todo en orden', alerta: 'Atención: es sospechoso', peligro: 'Cuidado: posible estafa' };
  const NIVELES = { tranquilo: 'No encontré señales de peligro.', alerta: 'Tiene señales sospechosas.', peligro: 'Tiene muchas señales de estafa.' };
  function mostrarAnalisis(r) {
    stats.analisis++; if (r.nivel !== 'tranquilo') stats.alertas++;
    const art = $('a-resultado'); art.hidden = false; art.dataset.n = r.nivel;
    $('a-titulo').textContent = TITULOS[r.nivel] || 'Resultado';
    $('a-nivel').textContent = NIVELES[r.nivel] || '';
    $('a-puntaje').textContent = r.puntaje;
    $('a-arco').style.strokeDashoffset = String(97.4 * (1 - Math.max(0, Math.min(100, r.puntaje)) / 100));
    const ul = $('a-razones'); ul.textContent = '';
    for (const x of (r.razones || []).slice(0, 5)) { const li = document.createElement('li'); li.textContent = x; ul.append(li); }
    $('a-accion').textContent = r.accion || '';
  }

  // ---------------------------------------------------------------- bóveda
  const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  async function cargarBoveda() {
    try {
      const e = await (await fetch('/api/boveda')).json();
      const arch = e.archivos || [], cif = arch.filter(a => a.cifrado).length;
      $('b-total').textContent = arch.length; $('b-cifrados').textContent = cif; $('b-claro').textContent = arch.length - cif;
      if (e.carpeta) $('b-carpeta').textContent = e.carpeta;
      const chip = $('b-estado');
      chip.dataset.e = !e.creada ? 'nueva' : e.bloqueada ? 'bloqueada' : 'abierta';
      chip.textContent = !e.creada ? 'Sin crear' : e.bloqueada ? '🔒 Bloqueada' : '🔓 Abierta';
      $('b-clave').disabled = !e.creada;
      const ul = $('b-lista'); ul.textContent = '';
      if (!arch.length) { const li = document.createElement('li'); li.className = 'vacio-l'; li.textContent = e.creada ? 'Su bóveda está vacía. Abra la bóveda y arrastre ahí sus archivos.' : 'Aún no tiene bóveda. Ábrala para crear su contraseña maestra.'; ul.append(li); return; }
      for (const a of arch.slice(0, 12)) {
        const nom = a.nombre.replace(/\.lyfan$/, ''), ext = (nom.match(/\.([^.]+)$/) || [, 'archivo'])[1].toUpperCase().slice(0, 5);
        const li = document.createElement('li');
        li.innerHTML = '<span class="ext"></span><span class="n"></span><span class="tenue"></span><span class="c"></span>';
        li.children[0].textContent = ext; li.children[1].textContent = nom; li.children[2].textContent = fmt(a.bytes);
        li.children[3].textContent = a.cifrado ? 'Cifrado' : 'Sin cifrar'; li.children[3].classList.add(a.cifrado ? 'si' : 'no');
        ul.append(li);
      }
    } catch { $('b-estado').textContent = 'Sin conexión'; }
  }
  $('b-abrir').addEventListener('click', () => enviarALyFan({ tipo: 'boveda', tarea: { accion: 'mostrar', filtro: 'todos' } }));
  $('b-clave').addEventListener('click', () => enviarALyFan({ tipo: 'boveda', tarea: { accion: 'cambiar' } }));
  $('b-carpeta-bt').addEventListener('click', () => fetch('/api/boveda/abrir-carpeta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}));
  if ('BroadcastChannel' in window) {                 // la pantalla de la bóveda cambió algo: se actualiza la lista
    const cb = new BroadcastChannel('lyfan-boveda');
    cb.onmessage = ev => { const d = ev.data || {}; if (d.tipo === 'resultado' || d.tipo === 'cerrada') setTimeout(cargarBoveda, 300); };
  }

  // ---------------------------------------------------------------- actividad
  function pintarActividad() {
    $('s-mensajes').textContent = historial.filter(m => m.rol === 'usuario').length;
    $('s-analisis').textContent = stats.analisis; $('s-alertas').textContent = stats.alertas;
    const ol = $('linea'); ol.textContent = '';
    if (!historial.length) { const li = document.createElement('li'); li.textContent = 'Todavía no hay actividad en esta sesión.'; ol.append(li); return; }
    for (const m of historial.slice(-40).reverse()) {
      const li = document.createElement('li'); li.className = m.rol;
      li.innerHTML = '<time></time><span class="quien"></span><p></p>';
      li.children[0].textContent = hora(m.hora); li.children[1].textContent = m.rol === 'usuario' ? 'Usted' : 'LyFan'; li.children[2].textContent = m.texto;
      ol.append(li);
    }
  }

  // ---------------------------------------------------------------- estado de la IA
  async function salud() {
    const el = $('estado-ia');
    try {
      const s = await (await fetch('/api/salud')).json();
      const ok = s.ollama && s.modelo_disponible;
      el.dataset.e = ok ? 'ok' : 'basico';
      el.querySelector('span').textContent = ok ? 'IA local activa' : 'Modo básico';
      $('modelo').textContent = 'Modelo: ' + (s.modelo || '—');
    } catch { el.dataset.e = 'off'; el.querySelector('span').textContent = 'Sin conexión'; }
  }
  salud(); setInterval(salud, 30000);

  // ---------------------------------------------------------------- mensajes de LyFan
  if (canal) canal.onmessage = ev => {
    const d = ev.data || {};
    switch (d.tipo) {
      case 'estado':
        conectado = true; historial = (d.historial || []).map(m => ({ ...m })); pintarMensajes();
        if (d.burbuja) burbuja(d.burbuja); nivel(d.nivel); ponerPose(d.pose); pintarMic(d.mic);
        $('bt-voz').setAttribute('aria-pressed', String(d.vozActiva !== false));
        ocupado = !!d.ocupado; break;
      case 'burbuja': burbuja(d.texto); break;
      case 'pose': ponerPose(d.pose); break;
      case 'nivel': nivel(d.nivel); break;
      case 'mensaje': agregar({ rol: d.rol, texto: d.texto, hora: d.hora }); if (d.rol === 'usuario') escribiendo(true); else escribiendo(false); break;
      case 'ocupado':
        ocupado = !!d.valor; $('bt-enviar').disabled = ocupado;
        if (!ocupado) { escribiendo(false); $('a-analizar').disabled = false; $('a-analizar').textContent = 'Analizar ahora'; }
        break;
      case 'analisis': mostrarAnalisis(d.datos); break;
      case 'mic': pintarMic(d.estado); break;
      case 'voz': $('bt-voz').setAttribute('aria-pressed', String(!!d.activa)); break;
      default: break;
    }
  };
  function saludarALyFan() { enviarALyFan({ tipo: 'hola' }); }
  window.addEventListener('beforeunload', () => enviarALyFan({ tipo: 'adios' }));
  document.addEventListener('lyfan:listo', () => { saludarALyFan(); });
  saludarALyFan(); setTimeout(() => { if (!conectado) saludarALyFan(); }, 1500);
  setTimeout(() => { if (!conectado) { burbuja('No encuentro a LyFan. Abra LyFan Guard para conversar.'); $('estado-ia').dataset.e = 'off'; } }, 4000);
  pintarMensajes(); ajustar();
})();
