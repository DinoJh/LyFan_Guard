/* LyFan Guard · voz: LyFan habla (Dave sin internet o ElevenLabs, con respaldo automático y voz de Windows como último recurso)
   y escucha (micrófono + reconocimiento local en el servidor). Expone window.LyFanVoz. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ preferencias
  const CLAVE = 'lyfan-voz';
  const DAVE = 'es_ES-davefx-medium';            // la voz que se queda: funciona sin internet (Piper)
  const MOTORES = { dave: 'Dave · España (sin internet)', elevenlabs: 'ElevenLabs (su voz)' };
  const EFECTO_INICIAL = { dave: 40, elevenlabs: 0 };   // efecto robot sugerido para cada voz
  const POR_DEFECTO = {
    activa: true, motor: 'dave', volumen: 0.9, velocidad: 0, efectos: {},
    modoMic: 'manual',                           // 'manual' | 'nombre' (siempre encendido, solo si empiezo con «LyFan») | 'siempre'
    interrumpir: false, sensibilidad: 3, esperaDecimas: 12,
  };
  let prefs = { ...POR_DEFECTO };
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    prefs = { ...POR_DEFECTO, ...g };
    if (!MOTORES[prefs.motor]) prefs.motor = 'dave';                                          // se quitaron las demás voces
    if (!g.modoMic && g.manosLibres) prefs.modoMic = g.soloConNombre ? 'nombre' : 'siempre';  // preferencias de la versión anterior
  } catch { /* sin preferencias guardadas */ }
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(prefs)); } catch { /* no es grave */ } };

  function efectoDe(motor) {
    if (prefs.efectos && prefs.efectos[motor] != null) return prefs.efectos[motor];
    return EFECTO_INICIAL[motor] != null ? EFECTO_INICIAL[motor] : 0;
  }
  function definicion(motor) {
    if (motor === 'elevenlabs') return { prov: 'elevenlabs', voz: DAVE, tono: 0, vel: 0 };
    if (motor === 'sistema') return { prov: 'sistema' };
    return { prov: 'piper', voz: DAVE, tono: 0, vel: prefs.velocidad || 0 };
  }

  // ------------------------------------------------------------------ audio
  let ctx = null;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Efecto "robot": modulación en anillo + eco metálico (peine) + realce de agudos, mezclado con la voz limpia
  // para que siga siendo fluida y se entienda. cantidad: 0..1
  function conectar(fuente, cantidad, volumen) {
    const c = audio();
    const salida = c.createGain(); salida.gain.value = volumen;
    const comp = c.createDynamicsCompressor();
    salida.connect(comp); comp.connect(c.destination);
    if (cantidad < 0.02) { fuente.connect(salida); return []; }
    const seco = c.createGain(); seco.gain.value = 1 - 0.55 * cantidad;
    const humedo = c.createGain(); humedo.gain.value = 0.9 * cantidad;
    const anillo = c.createGain(); anillo.gain.value = 0;
    const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = 38 + 42 * cantidad; osc.connect(anillo.gain);
    const retardo = c.createDelay(0.05); retardo.delayTime.value = 0.0062;
    const realim = c.createGain(); realim.gain.value = 0.3 + 0.25 * cantidad;
    retardo.connect(realim); realim.connect(retardo);
    const mezcla = c.createGain();
    const agudos = c.createBiquadFilter(); agudos.type = 'highshelf'; agudos.frequency.value = 2600; agudos.gain.value = 5 * cantidad;
    fuente.connect(seco); seco.connect(salida);
    fuente.connect(anillo); anillo.connect(retardo); anillo.connect(mezcla); retardo.connect(mezcla);
    mezcla.connect(agudos); agudos.connect(humedo); humedo.connect(salida);
    osc.start();
    return [osc];
  }

  // ------------------------------------------------------------------ hablar
  let generacion = 0, cola = [], reproduciendo = false, hablado = 0, fuenteActual = null, esperando = [];
  const eventos = { inicio: () => {}, fin: () => {}, aviso: () => {} };

  async function pedirAudio(texto) {
    const motor = prefs.motor, d = definicion(motor);
    if (d.prov === 'sistema') return { sistema: true, texto };
    try {
      const r = await fetch('/api/voz/hablar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, proveedor: d.prov, voz: d.voz, tono: d.tono, velocidad: d.vel }),
      });
      if (!r.ok) {
        let msg = 'La voz en línea no respondió; usé la voz de Windows.';
        try { msg = (await r.json()).error + ' Usé la voz de Windows.'; } catch { /* sin detalle */ }
        eventos.aviso(msg);
        return { sistema: true, texto };
      }
      const aviso = r.headers.get('X-Aviso'); if (aviso) eventos.aviso(decodeURIComponent(aviso));
      const datos = await r.arrayBuffer();
      const buffer = await audio().decodeAudioData(datos);
      return { buffer, proveedor: r.headers.get('X-Proveedor') };
    } catch (e) {
      console.warn('Voz:', e);
      eventos.aviso('No pude generar la voz; usé la voz de Windows.');
      return { sistema: true, texto };
    }
  }

  function vozDelSistema() {
    const voces = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const es = voces.filter(v => /^es/i.test(v.lang));
    const pref = ['es-PE', 'es-MX', 'es-US', 'es-ES'];
    for (const p of pref) { const v = es.find(x => x.lang.replace('_', '-').toLowerCase() === p.toLowerCase()); if (v) return v; }
    return es[0] || null;
  }
  function hablarSistema(texto, gen) {
    return new Promise(resolver => {
      if (!window.speechSynthesis) { resolver(); return; }
      const u = new SpeechSynthesisUtterance(texto);
      const v = vozDelSistema(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-ES';
      u.volume = prefs.volumen; u.rate = 1.05; u.pitch = 1.15;
      u.onend = u.onerror = () => resolver();
      if (gen !== generacion) { resolver(); return; }
      speechSynthesis.speak(u);
    });
  }
  function tocar(buffer, gen) {
    return new Promise(resolver => {
      if (gen !== generacion) { resolver(); return; }
      const c = audio(), f = c.createBufferSource(); f.buffer = buffer;
      const extra = conectar(f, efectoDe(prefs.motor) / 100, prefs.volumen);
      fuenteActual = f;
      f.onended = () => { extra.forEach(o => { try { o.stop(); } catch { /* ya detenido */ } }); if (fuenteActual === f) fuenteActual = null; resolver(); };
      f.start();
    });
  }

  async function bucle(gen) {
    if (reproduciendo) return;
    reproduciendo = true;
    let hubo = false;
    while (cola.length && gen === generacion) {
      const item = cola.shift();
      const res = await item;
      if (gen !== generacion) break;
      if (!hubo) { hubo = true; eventos.inicio(); }
      if (res.sistema) await hablarSistema(res.texto, gen); else await tocar(res.buffer, gen);
    }
    reproduciendo = false;
    if (gen === generacion) {
      if (hubo) eventos.fin();
      const pendientes = esperando; esperando = []; pendientes.forEach(f => f());
    }
  }

  function encolar(frase) {
    frase = frase.trim();
    if (!prefs.activa || frase.length < 2) return;
    cola.push(pedirAudio(frase));          // empieza a generarse ya, mientras suena la anterior
    bucle(generacion);
  }

  function detener() {
    generacion++; cola = []; hablado = 0;
    try { if (fuenteActual) fuenteActual.stop(); } catch { /* ya detenido */ }
    fuenteActual = null; reproduciendo = false;
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch { /* sin voz del sistema */ }
    const p = esperando; esperando = []; p.forEach(f => f());
  }

  // Frases completas durante el streaming: se habla cada una apenas termina
  const FIN_FRASE = /[.!?…]+(?=\s)|\n+/g;
  function agregarTexto(acumulado) {
    if (!prefs.activa) return;
    const resto = acumulado.slice(hablado);
    let ultimo = 0, m; FIN_FRASE.lastIndex = 0;
    while ((m = FIN_FRASE.exec(resto))) {
      const fin = m.index + m[0].length, frase = resto.slice(ultimo, fin);
      if (frase.trim().length >= 14) { encolar(frase); ultimo = fin; }
    }
    hablado += ultimo;
  }
  function terminarRespuesta(texto) {
    if (!prefs.activa) return;
    const frase = texto.slice(hablado); hablado = texto.length;
    if (frase.trim()) encolar(frase);
  }
  function cuandoCalle(fn) { if (!reproduciendo && !cola.length) fn(); else esperando.push(fn); }
  const estaHablando = () => reproduciendo || cola.length > 0;

  async function probar(frase) {
    detener();
    const gen = generacion; hablado = 0;
    const texto = frase || 'Hola, soy LyFan. Así sueno con esta voz. ¿Revisamos juntos?';
    const prev = prefs.activa; prefs.activa = true;
    encolar(texto); prefs.activa = prev;
    return gen;
  }

  // ------------------------------------------------------------------ escuchar
  let grabacion = null;
  function escuchando() { return !!grabacion; }

  function escuchar({ alNivel, alEstado } = {}) {
    return new Promise(async (resolver, rechazar) => {
      if (grabacion) { grabacion.parar(); resolver(null); return; }
      detener();                                               // si LyFan hablaba, se calla
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        rechazar(new Error(e && e.name === 'NotAllowedError'
          ? 'No tengo permiso para usar el micrófono. Actívalo en Configuración de Windows > Privacidad > Micrófono.'
          : 'No encontré un micrófono.'));
        return;
      }
      const c = audio();
      const origen = c.createMediaStreamSource(stream), analizador = c.createAnalyser(); analizador.fftSize = 1024;
      origen.connect(analizador);
      const muestras = new Float32Array(analizador.fftSize);
      const tipo = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const trozos = []; rec.ondataavailable = e => { if (e.data && e.data.size) trozos.push(e.data); };

      let inicio = performance.now(), ruido = [], habloAlgo = false, ultimaVoz = 0, cancelado = false;
      const medir = setInterval(() => {
        analizador.getFloatTimeDomainData(muestras);
        let s = 0; for (let i = 0; i < muestras.length; i++) s += muestras[i] * muestras[i];
        const rms = Math.sqrt(s / muestras.length), t = performance.now() - inicio;
        if (alNivel) alNivel(Math.min(1, rms * 12));
        if (t < 450) { ruido.push(rms); return; }
        const base = ruido.length ? ruido.reduce((a, b) => a + b, 0) / ruido.length : 0.005;
        const umbral = Math.max(0.018, base * (6 - 0.9 * (prefs.sensibilidad || 3)));
        if (rms > umbral) { habloAlgo = true; ultimaVoz = t; }
        if ((habloAlgo && t - ultimaVoz > (prefs.esperaDecimas || 12) * 100) || t > 20000 || (!habloAlgo && t > 7000)) parar();
      }, 60);

      function parar() { if (rec.state !== 'inactive') rec.stop(); }
      grabacion = { parar, cancelar: () => { cancelado = true; parar(); } };
      rec.onstop = async () => {
        clearInterval(medir); stream.getTracks().forEach(t => t.stop()); origen.disconnect(); grabacion = null;
        if (cancelado || !habloAlgo) { resolver(''); return; }
        try {
          if (alEstado) alEstado('transcribiendo');
          const blob = new Blob(trozos, { type: rec.mimeType || 'audio/webm' });
          const r = await fetch('/api/voz/transcribir', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'No pude entender el audio.');
          resolver((j.texto || '').trim());
        } catch (e) { rechazar(e); }
      };
      rec.start(250);
    });
  }
  function cancelarEscucha() { if (grabacion) grabacion.cancelar(); }


  // ------------------------------------------------------------------ manos libres: el micrófono queda encendido
  // Detecta cuándo empiezas a hablar (guarda también medio segundo antes), cuándo te callas y entonces transcribe.
  // Mientras LyFan habla o piensa no escucha (para no oírse a sí mismo), salvo que se permita interrumpirlo.
  const ML = { activo: false, pausado: false, estado: 'apagado' };
  let mlFlujo = null, mlOrigen = null, mlProc = null, mlMudo = null, mlCfg = null;
  let mlRuido = 0.006, mlPre = [], mlVoz = null, mlSobre = 0, mlFuerte = 0, mlLibreDesde = 0, mlProcesando = false;

  function mlEstado(e) { if (ML.estado !== e) { ML.estado = e; if (mlCfg && mlCfg.alEstado) mlCfg.alEstado(e); } }

  function codificarWav(pcm, hz) {                                // Float32 -> WAV PCM de 16 bits, mono
    const buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
    const txt = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); txt(8, 'WAVE'); txt(12, 'fmt '); d.setUint32(16, 16, true);
    d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, hz, true); d.setUint32(28, hz * 2, true);
    d.setUint16(32, 2, true); d.setUint16(34, 16, true); txt(36, 'data'); d.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); d.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function a16k(trozos, hzOrigen) {                               // junta los trozos y baja a 16 kHz (promedio por ventana)
    let n = 0; trozos.forEach(t => { n += t.length; });
    const todo = new Float32Array(n); let o = 0; trozos.forEach(t => { todo.set(t, o); o += t.length; });
    const razon = hzOrigen / 16000, salida = new Float32Array(Math.floor(n / razon));
    for (let i = 0; i < salida.length; i++) {
      const a = Math.floor(i * razon), b = Math.min(n, Math.floor((i + 1) * razon)); let s = 0;
      for (let k = a; k < b; k++) s += todo[k];
      salida[i] = b > a ? s / (b - a) : 0;
    }
    return salida;
  }

  async function mlEnviar(trozos, hz) {
    mlProcesando = true; mlEstado('procesando');
    try {
      const wav = codificarWav(a16k(trozos, hz), 16000);
      const r = await fetch('/api/voz/transcribir', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'No pude entender el audio.');
      const t = (j.texto || '').trim();
      if (t && mlCfg && mlCfg.alTexto) mlCfg.alTexto(t); else if (mlCfg && mlCfg.alNada) mlCfg.alNada();
    } catch (e) { if (mlCfg && mlCfg.alError) mlCfg.alError(e); }
    finally { mlProcesando = false; mlLibreDesde = performance.now() + 400; mlEstado(ML.pausado ? 'pausa' : 'escuchando'); }
  }

  function mlProcesar(datos, hz) {
    if (ML.pausado) { mlPre = []; mlVoz = null; mlSobre = 0; return; }
    const o = mlCfg.opciones(), ahora = performance.now();
    let s = 0; for (let i = 0; i < datos.length; i++) s += datos[i] * datos[i];
    const rms = Math.sqrt(s / datos.length);
    if (mlCfg.alNivel) mlCfg.alNivel(mlVoz ? Math.min(1, rms * 10) : 0);   // las barras de «Escuchando» siguen su voz
    const bloqueo = mlProcesando ? 'ocupado' : mlCfg.bloqueado();     // false | 'ocupado' | 'hablando'
    if (bloqueo) {                                                     // LyFan piensa o habla
      mlLibreDesde = ahora + 600; mlPre = []; mlSobre = 0;
      if (mlVoz) { mlVoz = null; mlEstado('escuchando'); }
      if (bloqueo === 'hablando' && o.interrumpir) {                  // opcional: una voz fuerte lo interrumpe
        mlFuerte = rms > Math.max(0.06, mlRuido * 8) ? mlFuerte + 1 : 0;
        if (mlFuerte >= 6) { mlFuerte = 0; mlCfg.interrumpir(); mlLibreDesde = 0; }
      }
      return;
    }
    mlFuerte = 0;
    const umbral = Math.max(0.015, mlRuido * (6 - 0.9 * o.sensibilidad));
    const copia = new Float32Array(datos);
    if (!mlVoz) {
      if (rms < umbral) mlRuido = Math.max(0.002, mlRuido * 0.96 + rms * 0.04);     // aprende el ruido de fondo
      mlPre.push(copia); while (mlPre.length > 11) mlPre.shift();                      // ~0,5 s antes de que hables
      if (ahora < mlLibreDesde) { mlSobre = 0; return; }
      mlSobre = rms > umbral ? mlSobre + 1 : 0;
      if (mlSobre >= 3) { mlVoz = { trozos: mlPre.slice(), inicio: ahora, ultima: ahora }; mlPre = []; mlEstado('voz'); }
      return;
    }
    mlVoz.trozos.push(copia);
    if (rms > umbral * 0.7) mlVoz.ultima = ahora;
    if (ahora - mlVoz.ultima > o.espera * 1000 || ahora - mlVoz.inicio > 25000) {   // te callaste (o la frase es larguísima)
      const habla = mlVoz.ultima - mlVoz.inicio, trozos = mlVoz.trozos; mlVoz = null; mlSobre = 0;
      if (habla < 450) { mlEstado('escuchando'); return; }                           // un ruido corto, no una frase
      mlEnviar(trozos, hz);
    }
  }

  async function iniciarManos(cfg) {
    mlCfg = cfg;
    if (ML.activo) { ML.pausado = false; mlEstado('escuchando'); return; }
    let flujo;
    try { flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) {
      throw new Error(e && e.name === 'NotAllowedError'
        ? 'No tengo permiso para usar el micrófono. Actívalo en Configuración de Windows > Privacidad > Micrófono.'
        : 'No encontré un micrófono.');
    }
    const c = audio();
    mlFlujo = flujo; mlOrigen = c.createMediaStreamSource(flujo);
    mlProc = c.createScriptProcessor(2048, 1, 1);
    mlMudo = c.createGain(); mlMudo.gain.value = 0;                  // el procesador necesita salida, pero no se oye
    mlOrigen.connect(mlProc); mlProc.connect(mlMudo); mlMudo.connect(c.destination);
    mlProc.onaudioprocess = e => { try { mlProcesar(e.inputBuffer.getChannelData(0), c.sampleRate); } catch (err) { console.warn('Manos libres:', err); } };
    ML.activo = true; ML.pausado = false; mlRuido = 0.006; mlPre = []; mlVoz = null; mlSobre = 0; mlProcesando = false;
    mlLibreDesde = performance.now() + 800;
    mlEstado('escuchando');
  }
  function detenerManos() {
    try { if (mlProc) { mlProc.onaudioprocess = null; mlProc.disconnect(); } if (mlOrigen) mlOrigen.disconnect(); if (mlMudo) mlMudo.disconnect(); } catch { /* ya desconectado */ }
    if (mlFlujo) mlFlujo.getTracks().forEach(t => t.stop());
    mlFlujo = mlOrigen = mlProc = mlMudo = null; mlVoz = null; mlPre = [];
    ML.activo = false; ML.pausado = false; mlEstado('apagado');
  }
  function pausarManos(p) {
    if (!ML.activo) return;
    ML.pausado = !!p; if (p) { mlVoz = null; mlPre = []; mlSobre = 0; }
    mlEstado(p ? 'pausa' : (mlProcesando ? 'procesando' : 'escuchando'));
  }

  window.LyFanVoz = {
    get prefs() { return prefs; },
    guardarPrefs: nuevo => { prefs = { ...prefs, ...nuevo }; guardar(); },
    setEfecto: (motor, valor) => { prefs.efectos = { ...(prefs.efectos || {}), [motor]: valor }; guardar(); },
    efectoDe, MOTORES, DAVE,
    detener, agregarTexto, terminarRespuesta, cuandoCalle, estaHablando, probar,
    escuchar, escuchando, cancelarEscucha,
    manos: { iniciar: iniciarManos, detener: detenerManos, pausar: pausarManos,
             get activo() { return ML.activo; }, get pausado() { return ML.pausado; }, get estado() { return ML.estado; } },
    on: (nombre, fn) => { eventos[nombre] = fn; },
  };
  if (window.speechSynthesis) speechSynthesis.getVoices();   // algunas versiones las cargan en diferido
})();
