/* LyFan Guard · panel de configuración: un menú con tres apartados (Tamaño, Micrófono y Voces).
   Usa window.LyFanVoz (voz.js) y window.LyFanApp (overlay.js). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const V = window.LyFanVoz, App = window.LyFanApp, escritorio = App.escritorio;
  const panel = $('ajustes');

  // ================================================================== navegación
  const TITULOS = { menu: 'Configuración', tamano: 'Tamaño', mic: 'Micrófono', voz: 'Voces' };
  function ir(vista) {
    panel.querySelectorAll('.aj-vista').forEach(v => { v.hidden = v.dataset.vista !== vista; });
    $('aj-titulo').textContent = TITULOS[vista];
    $('aj-atras').hidden = vista === 'menu';
    panel.querySelector('.aj-cuerpo').scrollTop = 0;
    if (vista === 'voz') cargarConfigVoz();
    resumenes();
  }
  function abrir() { App.cerrarPaneles(); panel.hidden = false; ir('menu'); }
  function cerrar() { panel.hidden = true; }
  $('btn-ajustes').addEventListener('click', () => (panel.hidden ? abrir() : cerrar()));
  $('aj-cerrar').addEventListener('click', cerrar);
  $('aj-atras').addEventListener('click', () => ir('menu'));
  panel.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => ir(b.dataset.ir)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) cerrar(); });

  const NOMBRE_MODO = { manual: 'Yo lo enciendo y lo apago', nombre: 'Siempre encendido · responde si empiezo con «LyFan»', siempre: 'Siempre encendido · responde cada vez que hablo' };
  function resumenes() {
    $('aj-res-tamano').textContent = `${Math.round(escala * 100)} %`;
    $('aj-res-mic').textContent = NOMBRE_MODO[V.prefs.modoMic] || '';
    $('aj-res-voz').textContent = (V.prefs.activa ? V.MOTORES[V.prefs.motor] : 'Silenciada') + '';
  }

  // ================================================================== tamaño
  const BASE_ROBOT = 300, CLAVE_TAMANO = 'lyfan-tamano';
  let escala = 1, avisarVentana = 0;
  try { const g = parseFloat(localStorage.getItem(CLAVE_TAMANO)); if (g >= 0.5 && g <= 1.5) escala = g; } catch { /* sin guardado */ }
  function medidas(e) {
    const robot = Math.round(BASE_ROBOT * e);
    return { robot, ancho: Math.max(380, robot + 80), alto: Math.max(520, robot + 250) };
  }
  function aplicarTamano(e, { persistir = true, inmediato = false } = {}) {
    escala = Math.min(1.5, Math.max(0.5, Math.round(e * 100) / 100));
    const m = medidas(escala), st = document.documentElement.style;
    st.setProperty('--pet-size', m.robot + 'px'); st.setProperty('--ov-w', (m.ancho - 20) + 'px');
    if (persistir) { try { localStorage.setItem(CLAVE_TAMANO, String(escala)); } catch { /* no es grave */ } }
    if (escritorio) {                                           // la ventana se adapta al tamaño
      clearTimeout(avisarVentana);
      const enviar = () => escritorio.ajustarTamano(m.ancho, m.alto, escala, m.robot);
      if (inmediato) enviar(); else avisarVentana = setTimeout(enviar, 70);
    }
    pintarTamano();
  }
  function pintarTamano() {
    const pct = Math.round(escala * 100);
    $('aj-tamano').value = pct; $('aj-tamano-v').textContent = pct + ' %';
    document.querySelectorAll('[data-tamano]').forEach(b => b.classList.toggle('activo', Number(b.dataset.tamano) === pct));
    resumenes();
  }
  $('aj-tamano').addEventListener('input', e => aplicarTamano(e.target.value / 100));
  document.querySelectorAll('[data-tamano]').forEach(b => b.addEventListener('click', () => aplicarTamano(Number(b.dataset.tamano) / 100, { inmediato: true })));
  aplicarTamano(escala, { persistir: false, inmediato: true });

  // ================================================================== micrófono
  function pintarMicrofono() {
    const modo = V.prefs.modoMic;
    document.querySelectorAll('input[name="aj-modo-mic"]').forEach(r => { r.checked = r.value === modo; });
    $('aj-sens').value = V.prefs.sensibilidad; $('aj-sens-v').textContent = ['', 'muy baja', 'baja', 'media', 'alta', 'muy alta'][V.prefs.sensibilidad] || '';
    $('aj-espera').value = V.prefs.esperaDecimas; $('aj-espera-v').textContent = (V.prefs.esperaDecimas / 10).toFixed(1).replace('.', ',') + ' s';
    $('aj-interrumpir').checked = !!V.prefs.interrumpir;
    $('aj-fila-interrumpir').hidden = modo === 'manual';        // solo tiene sentido con el micrófono siempre encendido
    resumenes();
  }
  document.querySelectorAll('input[name="aj-modo-mic"]').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    App.aplicarModoMic(r.value); pintarMicrofono(); estadoManos(App.estadoMic());
  }));
  $('aj-interrumpir').addEventListener('change', e => V.guardarPrefs({ interrumpir: e.target.checked }));
  $('aj-sens').addEventListener('input', e => { V.guardarPrefs({ sensibilidad: Number(e.target.value) }); pintarMicrofono(); });
  $('aj-espera').addEventListener('input', e => { V.guardarPrefs({ esperaDecimas: Number(e.target.value) }); pintarMicrofono(); });

  function estadoManos(e) {                                     // lo que hace el micrófono siempre encendido, en vivo
    const el = $('aj-manos-estado');
    if (e === 'error') { pintarMicrofono(); el.textContent = 'No pude encender el micrófono; vuelvo al modo manual.'; return; }
    el.textContent = V.prefs.modoMic === 'manual' ? ''
      : e === 'pausa' ? 'En pausa: toque el micrófono para volver a escuchar.'
      : e === 'voz' ? 'Lo estoy oyendo…' : e === 'procesando' ? 'Entendiendo lo que dijo…'
      : e === 'escuchando' ? 'Escuchando: hable cuando quiera.' : '';
  }
  App.alEstadoMic(estadoManos);

  $('aj-mic-probar').addEventListener('click', async () => {
    const est = $('aj-mic-estado');
    if (V.escuchando()) { V.escuchar(); return; }
    if (V.manos.activo) { est.textContent = 'Hable ahora: el indicador de abajo mostrará que lo oye.'; est.className = 'aj-nota'; return; }
    est.textContent = 'Hable ahora…'; est.className = 'aj-nota';
    try {
      const t = await V.escuchar({ alEstado: e => { if (e === 'transcribiendo') est.textContent = 'Entendiendo…'; } });
      if (t === null) return;
      est.textContent = t ? `Escuché: «${t}»` : 'No escuché nada. Revise su micrófono.'; est.className = 'aj-nota ' + (t ? 'estado-ok' : 'estado-mal');
    } catch (e) { est.textContent = e.message; est.className = 'aj-nota estado-mal'; }
  });

  // ================================================================== voces
  let configVoz = null;
  const selMotor = $('aj-motor'), rVol = $('aj-volumen'), rVel = $('aj-velocidad'), rEfecto = $('aj-efecto');
  const opcion = (valor, texto) => { const o = document.createElement('option'); o.value = valor; o.textContent = texto; return o; };

  async function cargarConfigVoz() {
    try { configVoz = await (await fetch('/api/voz/config')).json(); } catch { configVoz = null; }
    construirOpciones(); pintarVoces(); estadoDave();
  }
  function construirOpciones() {
    selMotor.textContent = '';
    Object.entries(V.MOTORES).forEach(([id, nombre]) => selMotor.append(opcion(id, nombre)));
    const sm = $('aj-el-modelo'); sm.textContent = '';
    ((configVoz && configVoz.modelos_eleven) || []).forEach(m => sm.append(opcion(m.id, m.nombre)));
  }
  function pintarVoces() {
    $('aj-activa').checked = V.prefs.activa;
    selMotor.value = V.prefs.motor;
    rVol.value = Math.round(V.prefs.volumen * 100); $('aj-vol-v').textContent = rVol.value + ' %';
    rVel.value = V.prefs.velocidad || 0; $('aj-vel-v').textContent = (rVel.value > 0 ? '+' : '') + rVel.value + ' %';
    rVel.disabled = V.prefs.motor === 'elevenlabs';              // la velocidad se ajusta en la voz Dave
    const ef = V.efectoDe(V.prefs.motor); rEfecto.value = ef; $('aj-efecto-v').textContent = ef + ' %';
    const el = configVoz && configVoz.elevenlabs;
    if (el) {
      $('aj-el-voz').value = el.voice_id || ''; if (el.modelo) $('aj-el-modelo').value = el.modelo;
      $('aj-el-clave').placeholder = el.tiene_clave ? `Clave guardada ${el.clave_fin} (escriba otra para cambiarla)` : 'Pegue su clave de ElevenLabs';
    }
    resumenes();
  }
  function dave() { return ((configVoz && configVoz.voces_piper) || []).find(p => p.id === V.DAVE); }
  function estadoDave() {                                       // ¿está descargada la voz que funciona sin internet?
    const est = $('aj-piper-estado'), d = dave(); est.textContent = ''; est.className = 'aj-nota';
    if (!d) return;
    if (d.instalada) { est.textContent = 'Dave está listo: funciona sin internet.'; est.className = 'aj-nota estado-ok'; return; }
    est.textContent = `Dave todavía no está descargada (${d.mb} MB, una sola vez). `;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mini principal'; b.textContent = 'Descargar';
    b.addEventListener('click', () => descargarDave());
    est.append(b);
  }
  async function descargarDave() {
    const est = $('aj-piper-estado'), d = dave(); if (!d) return true;
    est.textContent = `Descargando la voz (${d.mb} MB)… solo se hace una vez.`; est.className = 'aj-nota';
    try {
      const r = await fetch('/api/voz/piper/descargar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: V.DAVE }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No pude descargar la voz.');
      configVoz.voces_piper = j.voces_piper; estadoDave(); return true;
    } catch (e) { est.textContent = e.message; est.className = 'aj-nota estado-mal'; return false; }
  }
  async function probarVoz(texto) {
    if (V.prefs.motor === 'dave' && dave() && !dave().instalada && !(await descargarDave())) return;
    V.probar(texto);
  }

  selMotor.addEventListener('change', () => { V.guardarPrefs({ motor: selMotor.value }); pintarVoces(); probarVoz(); });
  $('aj-activa').addEventListener('change', e => { V.guardarPrefs({ activa: e.target.checked }); if (!e.target.checked) V.detener(); pintarVoces(); });
  rVol.addEventListener('input', () => { V.guardarPrefs({ volumen: rVol.value / 100 }); $('aj-vol-v').textContent = rVol.value + ' %'; });
  rVol.addEventListener('change', () => probarVoz());
  rVel.addEventListener('input', () => { V.guardarPrefs({ velocidad: Number(rVel.value) }); $('aj-vel-v').textContent = (rVel.value > 0 ? '+' : '') + rVel.value + ' %'; });
  rVel.addEventListener('change', () => probarVoz());
  rEfecto.addEventListener('input', () => { V.setEfecto(V.prefs.motor, Number(rEfecto.value)); $('aj-efecto-v').textContent = rEfecto.value + ' %'; });
  rEfecto.addEventListener('change', () => probarVoz());
  $('aj-probar').addEventListener('click', () => probarVoz());

  // --- ElevenLabs (clave e ID de voz)
  App.alAvisoVoz(msg => { if (!panel.hidden) { const est = $('aj-el-estado'); est.textContent = msg; est.className = 'aj-nota estado-mal'; } });
  async function guardarEleven(borrar) {
    const est = $('aj-el-estado');
    const cuerpo = { elevenlabs_voice_id: $('aj-el-voz').value.trim(), elevenlabs_modelo: $('aj-el-modelo').value, borrar_clave: !!borrar };
    const clave = $('aj-el-clave').value.trim(); if (clave) cuerpo.elevenlabs_clave = clave;
    try {
      const r = await fetch('/api/voz/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No pude guardar.');
      configVoz = { ...configVoz, ...j }; $('aj-el-clave').value = '';
      if (borrar) {
        est.textContent = 'Clave borrada.'; est.className = 'aj-nota';
        if (V.prefs.motor === 'elevenlabs') V.guardarPrefs({ motor: 'dave' });
      } else if (j.elevenlabs.configurado) {
        est.textContent = 'Guardado. Probando su voz de ElevenLabs…'; est.className = 'aj-nota estado-ok';
        V.guardarPrefs({ motor: 'elevenlabs' }); pintarVoces();
        V.probar('Hola, señor. Soy LyFan, y ahora le hablo con su voz de ElevenLabs.');
      } else { est.textContent = 'Guardado. Falta la clave o el ID de voz.'; est.className = 'aj-nota'; }
      pintarVoces();
    } catch (e) { est.textContent = e.message; est.className = 'aj-nota estado-mal'; }
  }
  $('aj-el-guardar').addEventListener('click', () => guardarEleven(false));
  $('aj-el-borrar').addEventListener('click', () => guardarEleven(true));

  // ================================================================== arranque
  pintarMicrofono(); pintarVoces(); resumenes();
})();
