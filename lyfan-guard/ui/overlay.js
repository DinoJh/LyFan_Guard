/* LyFan Guard · núcleo de la interfaz flotante.
   Orden de este archivo: 1) utilidades, 2) frases y expresiones, 3) ánimo en reposo, 4) conversación,
   5) enviar un mensaje, 6) controles, 7) voz, 8) micrófono, 9) ventana de escritorio, 10) arranque.
   LyFan trata a la persona con respeto: de «usted» y llamándola «señor». */
(() => {
  'use strict';

  // ================================================================== 1. utilidades
  const $ = id => document.getElementById(id);
  const root = $('lyfan-unified');
  const frase = root.querySelector('.pet-phrase');
  const etiqueta = root.querySelector('.pet-speech-label');
  const hit = root.querySelector('.pet-hit');
  const dock = $('dock'), entrada = $('entrada'), btnEnviar = $('btn-enviar'), btnMic = $('btn-mic');
  const tarjeta = $('resultado'), log = $('log'), listaLog = $('log-lista'), ajustes = $('ajustes');
  const escritorio = window.lyfanDesktop || null;           // solo existe dentro de la ventana de Electron
  const V = window.LyFanVoz;

  const MIN_ANALISIS_MS = 650;                              // la expresión «Analizar» se ve al menos este tiempo
  const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|pe|net|org|gob|xyz|top|click|icu|live|site|online|shop|vip|club|ly|gl)\b/i;

  let historial = [];                                       // [{rol:'usuario'|'lyfan', texto}]
  let ocupado = false;                                      // LyFan está pensando o respondiendo
  let textoBurbuja = '';
  let temporizadorPose = 0;
  let modoBasico = false;

  const azar = a => a[Math.floor(Math.random() * a.length)];

  // LyFan está listo cuando termina de cargar sus imágenes (el diseño avisa con el evento 'lyfan:listo').
  function listo(fn) {
    let hecho = false; const una = () => { if (!hecho) { hecho = true; fn(); } };
    if (root.dataset.renderer) una();
    else { document.addEventListener('lyfan:listo', una, { once: true }); setTimeout(una, 8000); }
  }
  // El modelo a veces responde con Markdown; en la burbuja se muestra como texto simple.
  function limpiarMd(t) {
    return t.replace(/\*\*|__|`/g, '').replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n');
  }
  function decir(texto) {
    textoBurbuja = texto; emitir({ tipo: 'burbuja', texto });
    if (window.LyFan) window.LyFan.say(texto);
    frase.scrollTop = frase.scrollHeight;
  }
  // Guiño y curioso duran como mínimo lo suficiente para verse: aunque algo pida volver a reposo antes, esperan.
  const MIN_POSE = { wink: 2000, curious: 3500 };
  let poseDesde = 0, idleDiferido = 0;
  function pose(nombre) {                                   // cambia de expresión conservando el texto de la burbuja
    if (!window.LyFan) return;
    const actual = window.LyFan.pose;
    if (actual === nombre) return;
    clearTimeout(idleDiferido);
    const minimo = MIN_POSE[actual];
    if (minimo && nombre === 'idle') {
      const resta = minimo - (performance.now() - poseDesde);
      if (resta > 0) { idleDiferido = setTimeout(() => { if (window.LyFan.pose === actual) pose('idle'); }, resta + 30); return; }
    }
    window.LyFan.setPose(nombre);
    window.LyFan.say(textoBurbuja);
  }
  function ponerPose(p) { clearTimeout(idleDiferido); window.LyFan.setPose(p); textoBurbuja = frase.textContent; }   // la expresión trae su propia frase
  function nivelBurbuja(nivel) { if (nivel) root.dataset.nivel = nivel; else delete root.dataset.nivel; emitir({ tipo: 'nivel', nivel: nivel || null }); }
  // Puente con la ventana principal (principal.html): ella muestra lo que pasa aquí y le pide cosas a LyFan
  const canalApp = 'BroadcastChannel' in window ? new BroadcastChannel('lyfan-app') : null;
  function emitir(m) { if (canalApp) { try { canalApp.postMessage(m); } catch { /* sin ventana principal */ } } }
  const nivelMic = n => { if (window.LyFan && window.LyFan.nivelMic) window.LyFan.nivelMic(n); };   // barras de «Escuchando»

  // ================================================================== 2. frases y expresiones
  const FRASES_POSE = {                                     // las frases del diseño, en tono respetuoso
    idle: 'A sus órdenes, señor. ¿Revisamos algo juntos?',
    listen: 'Lo escucho, señor. ¿Qué necesita?',
    curious: 'Mmm… ¿qué tenemos por aquí, señor?',
    wink: 'Todo listo, señor. Estoy a su servicio.',
    scan: 'Activando el escáner, señor. Permítame revisar con detalle.',
    scanTalk: 'Estoy revisando los detalles, señor. Le cuento lo que encuentro.',
    alert: '¡Atención, señor! Yo protejo este equipo.',
    alertTalk: 'Detecté algo que debemos revisar, señor. Se lo explico con cuidado.',
    sleep: 'Zzz… descansando, señor. Llámeme cuando guste.',
    happy: '¡Es un gusto verlo, señor!',
    talk: 'Se lo explico con calma, señor.',
    work: 'Manos al teclado, señor. Estoy en ello.',
    workTalk: 'Sigo trabajando, señor. Le cuento cómo vamos.',
    encrypt: 'Estoy cifrando. Un momento…',
    decrypt: 'Estoy descifrando. Un momento…',
  };
  function aplicarFrases() {
    const d = window.LyFan && window.LyFan.datos; if (!d) return;
    for (const [p, t] of Object.entries(FRASES_POSE)) if (d[p]) d[p].phrase = t;
  }
  // Al hablar: con riesgo, «Alerta hablando»; al explicar un análisis tranquilo, «Analizar hablando»;
  // si todavía está generando la respuesta, «Trabajando hablando»; si no, «Hablando».
  // Tareas de la bóveda: al cifrar, «Cifrar»; al descifrar, «Descifrar»; al analizar, «Analizar hablando»; si hallan algo malo, «Alerta hablando».
  let poseDeTarea = null, ctxHabla = null, vencePose = 0;
  const poseHablando = (n, trabajando) => {
    if (n === 'alerta' || n === 'peligro') return 'alertTalk';
    const t = (ctxHabla && ctxHabla.tarea) || poseDeTarea;
    if (t === 'encrypt' || t === 'decrypt') return t;
    if (t === 'scan') return 'scanTalk';
    return n === 'tranquilo' ? 'scanTalk' : trabajando ? 'scanTalk' : 'talk';
  };
  const TEXTO_TAREA = { encrypt: 'Cifrando, un momento…', decrypt: 'Descifrando, un momento…', scan: 'Analizando el archivo, un momento…' };
  function poseTarea(p) {                                    // la pantalla de la bóveda avisa qué está haciendo
    if (p && p === poseDeTarea) return;
    clearTimeout(vencePose);
    poseDeTarea = p || null;
    if (!p) { if (!ocupado && !hablando() && !ctxHabla) volverAReposo(600); return; }
    despertar(); clearTimeout(temporizadorPose); limpiarOcio(); nivelBurbuja(null);
    if (!ocupado) decir(TEXTO_TAREA[p]);
    pose(p);
    vencePose = setTimeout(() => poseTarea(null), 120000);    // por si la pantalla se cierra sin avisar
  }

  // ¿Su respuesta dice que algo es malo? Entonces habla con «Alerta hablando». El modelo marca «[ALERTA]» al empezar;
  // si no lo hace, se buscan frases claras de peligro (sin contar las negadas: «no es un virus»).
  const RE_AMENAZA = [
    /\b(?:es|son|era|resulta|resultó|parece|podría ser|puede ser|sería)\s+(?:un[ao]?s?\s+)?(?:\w+\s+){0,2}?(?:malicios\w*|peligros\w*|sospechos\w*|fraudulent\w*|estafa|fraude|virus|malware|troyano|ransomware|phishing|amenaza)\b/i,
    /\b(?:es|son)\s+(?:muy\s+)?(?:malo|mala|malos|malas|dañino\w*|dañin\w*)\b/i,
    /\b(?:cuidado|peligro|riesgo (?:alto|elevado)|detecté (?:algo|señales|un|una)|señales (?:de peligro|sospechosas))\b/i,
  ];
  const RE_ORDEN = /\bno\s+(?:lo|la|los|las)?\s*(?:abra|abras|ejecute|ejecutes|descargue|descargues|instale|instales|toque|pulse|haga clic|haga click|comparta|compartas|responda|respondas)\b/i;
  const RE_NEGADO = /\b(?:no|ni|sin|nunca|tampoco|descart\w*)\b/i;
  const RE_DEFINICION = /\b(?:qué es|que es|qué son|qué significa|que significa|cómo funciona|como funciona|para qué sirve|explica\w*|diferencia)\b/i;
  function detectaAmenaza(t) {
    if (RE_ORDEN.test(t)) return true;
    for (const re of RE_AMENAZA) {
      const g = new RegExp(re.source, 'gi'); let m;
      while ((m = g.exec(t))) {
        const antes = t.slice(Math.max(0, m.index - 28), m.index).split(/[.!?\n]/).pop();
        if (!RE_NEGADO.test(antes)) return true;
      }
    }
    return false;
  }
  function procesarAlerta(t, pregunta) {                     // quita la etiqueta [ALERTA] y dice si hay que alertar
    const m = /^\s*\[(ALERTA|PELIGRO)\]\s*/i.exec(t);
    if (m) return { texto: t.slice(m[0].length), alerta: true };
    if (/^\s*\[[A-Za-z]{0,8}$/.test(t)) return { texto: '', alerta: false };   // la etiqueta aún está llegando
    return { texto: t, alerta: !RE_DEFINICION.test(pregunta || '') && detectaAmenaza(t) };
  }

  // ================================================================== 3. ánimo en reposo
  const ANIMO = { trabajaS: 50, duermeMin: 3 };             // a los 50 s se pone a trabajar; a los 3 minutos se duerme
  const FRASES_OCIO = ['Reviso que todo esté en orden…', 'Vigilando que no se cuele nada raro…', 'Afinando mis escáneres…', 'Revisando la seguridad en segundo plano…'];
  const FRASES_GESTO = {
    curious: ['Mmm… ¿qué tenemos por aquí?', 'Mmm… algo llamó mi atención.', '¿Y eso? Déjeme echar un vistazo…', 'Mmm… ¿qué será eso de allá?', 'Interesante… muy interesante.'],
    wink: ['Todo bajo control.', 'Aquí sigo, cuidando su equipo.', 'Tranquilo, yo vigilo.', 'Su equipo está en buenas manos.', 'Nada se me escapa.'],
  };
  const GESTOS = [['curious', 5], ['wink', 5], ['work', 2]];   // gestos al azar y su peso (kawaii solo con caricias o al volver)
  let ocioTimers = [];

  const hablando = () => !!(V && (V.estaHablando() || V.escuchando()));
  const oyendo = () => estadoMic === 'voz' || estadoMic === 'procesando';
  const libre = () => !ocupado && !hablando() && !oyendo() && !root.dataset.nivel && !!window.LyFan && window.LyFan.pose !== 'sleep';

  function volverAReposo(ms) {
    clearTimeout(temporizadorPose);
    temporizadorPose = setTimeout(() => { if (poseDeTarea) return; nivelBurbuja(null); pose('idle'); programarOcio(); }, ms);
  }
  function limpiarOcio() { ocioTimers.forEach(clearTimeout); ocioTimers = []; }
  function gestoAlAzar(primero) {                            // en reposo, de vez en cuando: curioso, guiño o una sonrisa
    const espera = (primero ? 20000 : 14000) + Math.random() * 16000;
    ocioTimers.push(setTimeout(() => {
      if (libre() && window.LyFan.pose === 'idle') {
        let r = Math.random() * GESTOS.reduce((a, g) => a + g[1], 0), g = GESTOS[0][0];
        for (const [p, w] of GESTOS) { if ((r -= w) <= 0) { g = p; break; } }
        ponerPose(g); if (FRASES_GESTO[g]) decir(azar(FRASES_GESTO[g]));
        ocioTimers.push(setTimeout(() => { if (libre() && window.LyFan.pose === g) pose('idle'); }, g === 'wink' ? 2400 : g === 'work' ? 5000 : 3900));
      }
      gestoAlAzar(false);
    }, espera));
  }
  function programarOcio() {                                 // se reinicia con cada actividad
    limpiarOcio();
    gestoAlAzar(true);
    ocioTimers.push(setTimeout(() => { if (libre()) { decir(azar(FRASES_OCIO)); pose('work'); } }, ANIMO.trabajaS * 1000));
    ocioTimers.push(setTimeout(() => {
      if (!ocupado && !hablando() && !oyendo() && !root.dataset.nivel) pose('sleep');   // se duerme solo, sin avisos
    }, ANIMO.duermeMin * 60000));
  }
  const reiniciarSueno = programarOcio;
  function despertar() {
    const p = window.LyFan && window.LyFan.pose;
    if (p === 'sleep' || (p === 'work' && !ocupado)) pose('idle');
  }

  // ================================================================== 4. conversación
  function agregarMensaje(rol, texto) {
    historial.push({ rol, texto, hora: Date.now() }); emitir({ tipo: 'mensaje', rol, texto, hora: Date.now() });
    if (historial.length > 30) historial = historial.slice(-30);
    pintarLog();
  }
  function pintarLog() {
    listaLog.textContent = '';
    if (!historial.length) {
      const v = document.createElement('div'); v.className = 'log-vacio'; v.textContent = 'Aún no hemos conversado, señor.'; listaLog.append(v); return;
    }
    for (const m of historial) {
      const d = document.createElement('div'); d.className = 'msg ' + m.rol; d.textContent = m.texto; listaLog.append(d);
    }
    listaLog.scrollTop = listaLog.scrollHeight;
  }
  function mostrarResultado(r) {
    emitir({ tipo: 'analisis', datos: r });
    tarjeta.dataset.nivel = r.nivel;
    $('res-titulo').textContent = { tranquilo: 'Todo en orden, señor', alerta: 'Atención: es sospechoso', peligro: '¡Cuidado, señor! Posible estafa' }[r.nivel];
    $('res-puntaje').textContent = `${r.puntaje}/100`;
    const ul = $('res-razones'); ul.textContent = '';
    for (const razon of r.razones.slice(0, 3)) { const li = document.createElement('li'); li.textContent = razon; ul.append(li); }
    $('res-accion').textContent = r.accion;
    tarjeta.classList.remove('abierto'); $('res-cab').setAttribute('aria-expanded', 'false');
    tarjeta.hidden = false;
  }
  function alternarResultado() {
    const abierto = tarjeta.classList.toggle('abierto'); $('res-cab').setAttribute('aria-expanded', String(abierto));
  }
  function ocultarResultado() { tarjeta.hidden = true; }
  function cerrarPaneles() { log.hidden = true; ajustes.hidden = true; ocultarResultado(); }

  // ================================================================== 5. enviar un mensaje
  async function enviar(texto, forzarAnalisis = false, viaVoz = false) {
    texto = texto.trim();
    if (!texto || ocupado) return;
    ocupado = true; btnEnviar.disabled = true; emitir({ tipo: 'ocupado', valor: true });
    clearTimeout(temporizadorPose); reiniciarSueno(); despertar();
    cerrarPaneles(); nivelBurbuja(null); V.detener();

    const analiza = forzarAnalisis || URL_RE.test(texto);
    const inicio = performance.now();
    pose('scan');
    decir((viaVoz ? 'Escuché: «' + texto + '». ' : '') + (analiza ? 'Permítame revisar esto con cuidado, señor…' : 'Un momento, señor…'));
    const previo = historial.slice(-8).map(m => ({ rol: m.rol, texto: m.texto }));
    agregarMensaje('usuario', texto);

    let acumulado = '', nivel = null, primerTrozo = true, fallo = false;
    try {
      let local = null;
      if (!forzarAnalisis && RE_PRINCIPAL.test(normal(texto))) {
        abrirPrincipal();
        local = azar(['Claro. Aquí tiene mi ventana principal.', 'Con gusto, le abro mi ventana principal.', 'Por supuesto. Ya le muestro mi ventana principal.']);
      }
      try { if (local === null && window.LyFanBoveda && !forzarAnalisis) local = await window.LyFanBoveda.comando(texto); } catch (e) { console.warn('Bóveda:', e); }
      if (local !== null) {
        primerTrozo = false; acumulado = local;
        if (!V.prefs.activa) pose(poseHablando(root.dataset.nivel, false));
        decir(limpiarMd(local).trim()); V.agregarTexto(limpiarMd(local));
      } else {
      const resp = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: texto, historial: previo, analizar: forzarAnalisis }),
      });
      if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
      const lector = resp.body.getReader(); const dec = new TextDecoder();
      let resto = '';
      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const lineas = resto.split('\n'); resto = lineas.pop();
        for (const linea of lineas) {
          if (!linea.trim()) continue;
          const ev = JSON.parse(linea);
          if (ev.tipo === 'analisis') {
            nivel = ev.datos.nivel;
            await new Promise(r => setTimeout(r, Math.max(0, MIN_ANALISIS_MS - (performance.now() - inicio))));
            mostrarResultado(ev.datos); nivelBurbuja(nivel);
            pose(nivel === 'tranquilo' ? 'wink' : 'alert');
          } else if (ev.tipo === 'modo') {
            const basico = ev.valor === 'plantilla';
            if (basico !== modoBasico) { modoBasico = basico; etiqueta.textContent = basico ? 'LyFan · modo básico' : 'LyFan'; }
          } else if (ev.tipo === 'token') {
            if (primerTrozo) {
              primerTrozo = false; acumulado = '';
              if (!V.prefs.activa) pose(poseHablando(nivel, true)); else if (!nivel) pose('scan');   // con voz, la boca se mueve cuando suena el audio
            }
            acumulado += ev.texto;
            const vis = procesarAlerta(acumulado, texto);
            if (vis.alerta && !nivel) { nivel = 'alerta'; nivelBurbuja(nivel); if (!V.prefs.activa || V.estaHablando()) pose('alertTalk'); }
            if (vis.texto) { decir(limpiarMd(vis.texto).trim()); V.agregarTexto(limpiarMd(vis.texto)); }
          }
        }
      }
      }
      const final = procesarAlerta(acumulado, texto).texto;
      if (!final.trim()) decir('Disculpe, señor, no supe qué responder. ¿Podría decírmelo de otra forma?');
      agregarMensaje('lyfan', limpiarMd(final || textoBurbuja).trim());
      frase.scrollTop = 0;                                    // al terminar, la burbuja se lee desde el principio
      V.terminarRespuesta(limpiarMd(final || textoBurbuja).trim());
    } catch (e) {
      console.error(e);
      decir('Disculpe, señor, perdí la conexión con mi cerebro local. Verifique que LyFan Guard esté encendido.');
      agregarMensaje('lyfan', textoBurbuja);
      pose('alert'); nivelBurbuja('alerta'); fallo = true;
    } finally {
      ocupado = false; btnEnviar.disabled = false; entrada.focus(); emitir({ tipo: 'ocupado', valor: false });
      if (window.LyFan.pose === 'scanTalk' && !nivel && V.estaHablando()) pose(poseHablando(nivel, false));   // ya terminó de generar: sigue «Hablando»
      V.cuandoCalle(() => {                                   // al terminar de hablar, LyFan se detiene
        if (fallo) volverAReposo(8000);
        else if (nivel === 'tranquilo') { pose('wink'); volverAReposo(2500); }
        else if (nivel) { pose('alert'); volverAReposo(25000); }   // con riesgo, la alerta se queda un buen rato
        else volverAReposo(V.prefs.activa ? 500 : 2500);
      });
    }
  }

  // ================================================================== 6. controles
  function ajustarAltura() { entrada.style.height = 'auto'; entrada.style.height = Math.min(84, entrada.scrollHeight) + 'px'; }
  entrada.addEventListener('input', () => { ajustarAltura(); reiniciarSueno(); despertar(); });
  entrada.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dock.requestSubmit(); }
    if (e.key === 'Escape') { cerrarPaneles(); V.detener(); }
  });
  dock.addEventListener('submit', e => { e.preventDefault(); const t = entrada.value; entrada.value = ''; ajustarAltura(); enviar(t); });
  $('btn-pegar').addEventListener('click', async () => {
    try {
      const t = escritorio ? await escritorio.leerPortapapeles() : await navigator.clipboard.readText();
      if (!t || !t.trim()) { decir('No encontré texto en su portapapeles, señor. Copie el mensaje e inténtelo de nuevo.'); return; }
      enviar(t.slice(0, 4000), true);
    } catch { decir('No pude leer el portapapeles, señor. Pegue el texto aquí abajo con Ctrl+V.'); entrada.focus(); }
  });
  $('btn-principal').addEventListener('click', () => abrirPrincipal());
  $('btn-log').addEventListener('click', () => { const abrir = log.hidden; cerrarPaneles(); log.hidden = !abrir; if (abrir) pintarLog(); });
  $('log-cerrar').addEventListener('click', () => { log.hidden = true; });
  $('res-cerrar').addEventListener('click', e => { e.stopPropagation(); ocultarResultado(); });
  $('res-cab').addEventListener('click', alternarResultado);
  $('res-cab').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarResultado(); } });
  hit.addEventListener('dblclick', () => {                    // doble clic: una sonrisa
    despertar(); clearTimeout(temporizadorPose); nivelBurbuja(null);
    root.dispatchEvent(new CustomEvent('lyfan:pet'));
    decir(azar(['¡Jejeje! Me hace cosquillas.', 'Awww… gracias por el cariño.', '¡Qué bonito! Me encantan las caricias.', 'Jeje… ¡otra, por favor!']));
    volverAReposo(3800);
  });
  let poseAnterior = null;                                    // si algo despierta a LyFan (clic, las z…), se reinician sus tiempos
  document.addEventListener('lyfan:pose', e => { poseDesde = performance.now(); emitir({ tipo: 'pose', pose: e.detail.pose }); const n = e.detail.pose; if (poseAnterior === 'sleep' && n !== 'sleep') programarOcio(); poseAnterior = n; });
  document.addEventListener('pointerdown', () => { reiniciarSueno(); });

  // ================================================================== 7. voz
  const oyentesAviso = [];
  function avisoVoz(msg) {
    etiqueta.textContent = 'LyFan · voz de respaldo'; etiqueta.title = msg;
    oyentesAviso.forEach(f => f(msg));
    setTimeout(() => { etiqueta.textContent = modoBasico ? 'LyFan · modo básico' : 'LyFan'; etiqueta.title = ''; }, 9000);
  }
  V.on('aviso', avisoVoz);
  V.on('inicio', () => pose(poseHablando(root.dataset.nivel, ocupado)));
  V.on('fin', () => {                                         // terminó de hablar: deja de mover la boca
    if (ocupado || poseDeTarea) return;
    const n = root.dataset.nivel;
    if (n === 'alerta' || n === 'peligro') pose('alert');     // sigue en alerta, ya sin hablar
    else if (n === 'tranquilo') pose('wink');
    else volverAReposo(300);
  });

  // ================================================================== 8. micrófono
  // Tres modos (V.prefs.modoMic): 'manual' (lo enciendo y lo apago), 'nombre' (siempre encendido; responde si empiezo con «LyFan»)
  // y 'siempre' (siempre encendido; responde cada vez que hablo).
  const siempreEncendido = () => V.prefs.modoMic !== 'manual';
  let pausaManual = false, ventanaOculta = false, estadoMic = 'apagado', principalAbierta = false;
  const oyentesMic = [];
  const mlOpciones = () => ({ sensibilidad: V.prefs.sensibilidad || 3, espera: (V.prefs.esperaDecimas || 12) / 10, interrumpir: !!V.prefs.interrumpir });

  // --- manual: un toque enciende, otro toque apaga (también se apaga solo al callarse)
  async function escucharYEnviar() {
    if (V.escuchando()) { V.escuchar(); return; }              // segundo toque: termina de grabar y envía
    if (ocupado) return;
    despertar(); reiniciarSueno(); cerrarPaneles(); clearTimeout(temporizadorPose);
    btnMic.classList.add('grabando'); btnMic.title = 'Lo escucho… toque para terminar';
    nivelBurbuja(null); decir('Lo escucho, señor. Hable con calma.'); pose('listen');
    try {
      const t = await V.escuchar({
        alNivel: n => nivelMic(n),
        alEstado: e => { if (e === 'transcribiendo') decir('Entendiendo lo que dijo, señor…'); },     // sigue «Escuchando»
      });
      if (t === null) return;
      if (!t) { decir('Disculpe, señor, no lo escuché bien. Toque el micrófono e inténtelo otra vez.'); volverAReposo(6000); return; }
      enviar(t, false, true);
    } catch (e) {
      decir(e.message || 'No pude usar el micrófono, señor.'); volverAReposo(9000);
    } finally {
      btnMic.classList.remove('grabando'); btnMic.title = 'Hablarle a LyFan'; nivelMic(0);
    }
  }

  // --- siempre encendido: responde cuando se calla y escucha cuando empieza a hablar
  function aplicarPausa() { if (V.manos.activo) V.manos.pausar(pausaManual || (ventanaOculta && !principalAbierta)); }
  function pintarMic(e) {
    const anterior = estadoMic; estadoMic = e;
    for (const k of ['activa', 'voz', 'procesando', 'pausa']) btnMic.classList.toggle('ml-' + k, (k === 'activa' && e === 'escuchando') || k === e);
    btnMic.title = !V.manos.activo ? 'Hablarle a LyFan'
      : e === 'pausa' ? 'Micrófono en pausa (toque para volver a escuchar)' : 'Micrófono encendido: lo escucho (toque para pausar)';
    if (e === 'voz' && !ocupado) {                              // empezó a hablar: «Escuchando»
      reiniciarSueno(); clearTimeout(temporizadorPose); despertar(); nivelBurbuja(null);
      decir('Lo escucho, señor…'); pose('listen');
    } else if (e === 'procesando' && !ocupado) {
      reiniciarSueno(); decir('Entendiendo lo que dijo, señor…'); pose('listen');
    } else if (e === 'escuchando' && (anterior === 'voz' || anterior === 'procesando') && !ocupado && window.LyFan.pose === 'listen') {
      volverAReposo(500);                                       // era un ruido o no se entendió nada
    }
    if (e !== 'voz') nivelMic(0);
    emitir({ tipo: 'mic', estado: e, modo: V.prefs.modoMic });
    oyentesMic.forEach(f => f(e));
  }
  // Modo «nombre»: la frase debe EMPEZAR con «LyFan» (se aceptan saludos como «oye» u «hola» antes)
  const RE_LLAMADA = /^[\s¿¡,.\-]*(?:(?:oye|hey|ey|ok|hola|buenas|buenos días|buen día)[\s,.\-]+)?ly\s?fan\b[\s,.:;!?¿¡\-]*/i;
  function textoManos(t) {
    let texto = t;
    if (V.prefs.modoMic === 'nombre') {
      const m = RE_LLAMADA.exec(t);
      if (!m) { volverAReposo(500); return; }                   // no me hablaban a mí
      texto = t.slice(m[0].length).trim();
      if (texto.length < 2) { decir('¿Sí, señor? Dígame.'); pose('listen'); volverAReposo(4000); return; }   // solo me llamaron
    }
    enviar(texto, false, true);
  }
  async function activarManosLibres() {
    try {
      await V.manos.iniciar({
        opciones: mlOpciones,
        bloqueado: () => (ocupado ? 'ocupado' : V.estaHablando() ? 'hablando' : false),
        interrumpir: () => V.detener(),
        alNivel: nivelMic, alEstado: pintarMic, alTexto: textoManos,
        alNada: () => { if (!ocupado) volverAReposo(500); },
        alError: e => { decir(e.message || 'No pude entenderlo, señor.'); volverAReposo(4000); },
      });
      aplicarPausa(); pintarMic(V.manos.estado);
    } catch (e) {
      V.guardarPrefs({ modoMic: 'manual' }); decir(e.message || 'No pude encender el micrófono, señor.'); pintarMic('apagado');
      oyentesMic.forEach(f => f('error'));
    }
  }
  function apagarManosLibres() { V.manos.detener(); pintarMic('apagado'); }
  function aplicarModoMic(modo) {                               // lo llama el panel de configuración
    V.guardarPrefs({ modoMic: modo });
    if (siempreEncendido()) { pausaManual = false; activarManosLibres(); } else apagarManosLibres();
  }
  btnMic.addEventListener('click', () => {
    if (!siempreEncendido()) { escucharYEnviar(); return; }
    if (!V.manos.activo) { pausaManual = false; activarManosLibres(); return; }
    pausaManual = !pausaManual; aplicarPausa(); pintarMic(V.manos.estado);
  });
  document.addEventListener('visibilitychange', () => { ventanaOculta = document.hidden; aplicarPausa(); pintarMic(V.manos.estado); });
  let estuvoOculto = false;
  if (escritorio && escritorio.alCambiarVisibilidad) escritorio.alCambiarVisibilidad(visible => {
    ventanaOculta = !visible; aplicarPausa(); pintarMic(V.manos.estado);
    if (!visible) { estuvoOculto = true; return; }
    if (estuvoOculto && !ocupado && !hablando() && window.LyFan) {   // al volver a abrirlo: kawaii y un saludo
      estuvoOculto = false; clearTimeout(temporizadorPose); nivelBurbuja(null);
      decir(azar(['¡Qué gusto verlo de nuevo!', '¡Volví! ¿En qué le ayudo?', '¡Aquí estoy otra vez!']));
      ponerPose('happy'); textoBurbuja = frase.textContent; volverAReposo(3600);
    }
  });

  // ================================================================== 9. ventana de escritorio (Electron)
  function probarExpresion(p) {                                 // desde el menú de clic derecho de la ventana
    if (!window.LyFan || !window.LyFan.poses.includes(p)) return;
    clearTimeout(temporizadorPose); limpiarOcio(); nivelBurbuja(null); V.detener();
    ponerPose(p);
    if (p === 'sleep') return;
    volverAReposo(p === 'alert' ? 6000 : 5000);
  }
  if (escritorio) {
    $('btn-ocultar').hidden = false;
    $('btn-ocultar').addEventListener('click', () => escritorio.ocultar());
    escritorio.alEnfocarEntrada(() => { despertar(); entrada.focus(); });
    escritorio.alMoverCursor((x, y) => { if (window.LyFan) window.LyFan.lookAt(x, y); });
    escritorio.alAccion(a => {                                  // acciones del menú de clic derecho
      if (a === 'analizar-portapapeles') $('btn-pegar').click();
      else if (a.startsWith('expresion:')) probarExpresion(a.slice(10));
    });

    // Arrastrar a LyFan para mover la ventana (clic corto = parpadeo o despertar, como en el diseño original)
    let arrastre = null, huboArrastre = false;
    hit.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      arrastre = { x: e.screenX, y: e.screenY, moviendo: false };
      hit.setPointerCapture(e.pointerId);
    });
    hit.addEventListener('pointermove', e => {
      if (!arrastre) return;
      const dx = e.screenX - arrastre.x, dy = e.screenY - arrastre.y;
      if (!arrastre.moviendo && Math.hypot(dx, dy) > 4) {
        arrastre.moviendo = true; huboArrastre = true; document.body.classList.add('arrastrando'); escritorio.arrastrarInicio();
      }
      if (arrastre.moviendo) escritorio.arrastrarMover(dx, dy);
    });
    const soltar = e => {
      if (!arrastre) return;
      if (arrastre.moviendo) escritorio.arrastrarFin();
      document.body.classList.remove('arrastrando'); arrastre = null;
      try { hit.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    };
    hit.addEventListener('pointerup', soltar); hit.addEventListener('pointercancel', soltar);
    // Si hubo arrastre, el «clic» que sigue no debe despertar ni hacer parpadear a LyFan
    hit.addEventListener('click', e => { if (huboArrastre) { e.stopImmediatePropagation(); e.preventDefault(); huboArrastre = false; } }, true);

    // Clic a través: lo transparente deja pasar el mouse a las ventanas de atrás
    const interactivos = '.pet-hit, .pet-speech, .dock, .resultado, .log, .pet-dream-z, .pet-alert-mark, .bv-modal';
    let ignorando = null;
    document.addEventListener('mousemove', e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const sobre = !!(el && el.closest(interactivos));
      if (ignorando === null || ignorando === sobre) { escritorio.ignorarMouse(!sobre); ignorando = !sobre; }
    });
    escritorio.ignorarMouse(true); ignorando = true;
  }

  // ================================================================== 10. arranque
  async function revisarSalud() {
    try {
      const s = await (await fetch('/api/salud')).json();
      const basico = !(s.ollama && s.modelo_disponible);
      if (basico !== modoBasico) { modoBasico = basico; etiqueta.textContent = basico ? 'LyFan · modo básico' : 'LyFan'; }
    } catch { /* el servidor aún no responde */ }
  }

  // ================================================================== ventana principal
  const normal = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const RE_PRINCIPAL = /\b(muestrate|mostrarte|aparece|abrete|(abre|abri|muestra|ensena|ensename|muestrame|pon|ponme|quiero ver) (tu|la|su) (ventana|interfaz|pantalla|aplicacion|app|panel)( principal)?|(ventana|interfaz|pantalla|panel) principal)\b/;
  function abrirPrincipal() {
    if (escritorio && escritorio.abrirPrincipal) escritorio.abrirPrincipal();
    else window.open('/principal.html', 'lyfan-principal');
  }
  if (canalApp) canalApp.onmessage = ev => {
    const d = ev.data || {};
    if (d.tipo === 'hola') {
      principalAbierta = true; aplicarPausa();
      canalApp.postMessage({ tipo: 'estado', historial, pose: window.LyFan && window.LyFan.pose, burbuja: textoBurbuja,
        nivel: root.dataset.nivel || null, mic: estadoMic, modoMic: V.prefs.modoMic, vozActiva: !!V.prefs.activa, ocupado, modoBasico });
    } else if (d.tipo === 'adios') { principalAbierta = false; aplicarPausa(); }
    else if (d.tipo === 'enviar' && d.texto) enviar(String(d.texto).slice(0, 4000), !!d.analizar);
    else if (d.tipo === 'mic') btnMic.click();
    else if (d.tipo === 'callar') V.detener();
    else if (d.tipo === 'voz') { $('btn-voz').click(); setTimeout(() => emitir({ tipo: 'voz', activa: !!V.prefs.activa }), 50); }
    else if (d.tipo === 'boveda' && window.LyFanBoveda) window.LyFanBoveda.abrirPantalla(d.tarea || null);
    else if (d.tipo === 'caricia') hit.dispatchEvent(new MouseEvent('dblclick'));
  };

  // Lo que el panel de configuración (ajustes.js) necesita de este archivo
  // LyFan dice algo que no viene del chat (por ejemplo, el resultado de una tarea de la bóveda)
  // o.tarea: 'encrypt' | 'decrypt' | 'scan' (qué estaba haciendo); o.nivel: 'tranquilo' | 'alerta' | 'peligro' (cómo salió)
  function responder(texto, o = {}) {
    const t = limpiarMd(String(texto || '')).trim(); if (!t) return;
    if (V.prefs.activa) V.detener();
    clearTimeout(temporizadorPose); clearTimeout(vencePose); limpiarOcio();
    ctxHabla = { tarea: o.tarea || poseDeTarea || null }; poseDeTarea = null;
    const nivel = o.nivel || null;
    nivelBurbuja(nivel);
    agregarMensaje('lyfan', t); decir(t); despertar();
    if (V.prefs.activa) { V.agregarTexto(t); V.terminarRespuesta(t); } else pose(poseHablando(nivel, false));
    V.cuandoCalle(() => {
      ctxHabla = null;
      if (nivel === 'alerta' || nivel === 'peligro') { pose('alert'); volverAReposo(25000); }
      else if (nivel === 'tranquilo') { pose('wink'); volverAReposo(2500); }
      else volverAReposo(V.prefs.activa ? 500 : 3000);
    });
  }

  // Un solo clic en LyFan oculta (o muestra) la barra de abajo: queda solo la mascota. No la despierta.
  hit.addEventListener('click', () => {
    const solo = document.body.classList.toggle('solo-mascota');
    if (solo) cerrarPaneles();
  });

  window.LyFanApp = {
    escritorio, decir, pose, cerrarPaneles, aplicarModoMic, responder, poseTarea, abrirPrincipal,
    estadoMic: () => estadoMic,
    alEstadoMic: f => oyentesMic.push(f),
    alAvisoVoz: f => oyentesAviso.push(f),
  };

  listo(() => {
    aplicarFrases();
    decir('Hola, señor. Soy LyFan, su asistente, y estoy para servirlo en temas de seguridad informática.');
    pose('happy'); volverAReposo(4200);
    revisarSalud(); setInterval(revisarSalud, 30000);
    if (siempreEncendido()) activarManosLibres();
  });
  pintarLog();
})();
