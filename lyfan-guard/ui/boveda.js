/* LyFan Guard · Bóveda, lado de LyFan: entiende lo que usted le pide por voz o chat y se lo encarga a la pantalla de la bóveda
   (boveda.html). La contraseña NUNCA se pide ni se acepta aquí: se escribe solo en la ventana de esa pantalla. */
(() => {
  'use strict';
  const App = window.LyFanApp;
  const esc = App.escritorio;
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('lyfan-boveda') : null;

  async function api(ruta, cuerpo) {
    const r = await fetch('/api/boveda' + ruta, cuerpo === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No pude completar la acción.');
    return j;
  }

  /** Abre (o trae al frente) la pantalla grande de la bóveda y le pasa un pedido. */
  function abrirPantalla(tarea) {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const t = tarea ? { ...tarea, id } : null;
    const p = tarea && { cifrar: 'encrypt', descifrar: 'decrypt', analizar: 'scan' }[tarea.accion];
    if (p && App.poseTarea) App.poseTarea(p);                                // cifrando, descifrando o analizando: su expresión
    if (esc && esc.abrirBoveda) esc.abrirBoveda(t);
    else window.open('/boveda.html' + (t ? '#t=' + encodeURIComponent(JSON.stringify(t)) : ''), 'lyfan-boveda');
    if (canal && t) setTimeout(() => canal.postMessage({ tipo: 'tarea', id, tarea }), 300);   // por si ya estaba abierta
  }

  // La pantalla le avisa a LyFan cómo terminó cada cosa, y LyFan lo dice en voz alta
  if (canal) canal.onmessage = ev => {
    const d = ev.data || {};
    if (d.tipo === 'resultado' && d.texto) App.responder(d.texto, { tarea: d.tarea, nivel: d.nivel });
    else if (d.tipo === 'pose') App.poseTarea(d.pose || null);
    else if (d.tipo === 'cerrada') App.poseTarea(null);
    else if (d.tipo === 'reintentar' && d.texto) {                          // la bóveda ya se creó: se retoma el pedido de antes
      setTimeout(async () => { try { const r = await comando(d.texto); if (r) App.responder(r); } catch { /* sin respuesta */ } }, 1500);
    }
  };
  const botonAjustes = document.getElementById('aj-abrir-boveda');
  if (botonAjustes) botonAjustes.addEventListener('click', () => { abrirPantalla(null); });

  // ---------------------------------------------------------------- entender lo que se pide
  const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const RE_CIFRAR = /\b(cifr\w*|encript\w*|enkript\w*|protege\w*|asegura\w*)\b/;
  const RE_DESCIFRAR = /\b(descifr\w*|desencript\w*|desencrip\w*|desprotege\w*)\b/;
  const RE_MOSTRAR = /\b(muestr\w*|ensen\w*|abre|abreme|abrir (?:la |mi |nuestra )?(?:boveda|carpeta)|ver|veamos|lista\w*|que (hay|tengo|tenemos|archivos)|dime|cuales|pantalla)\b/;
  const RE_ARCH = /\b(archivos?|boveda|carpeta|documentos?)\b/;
  const RE_BLOQUEAR = /\b(bloquea\w*|cierra\w*)\b.*\bboveda\b/;
  const RE_ANALIZAR = /\b(analiza\w*|revisa\w*|escanea\w*|examina\w*|verifica\w*|chequea\w*|es sospechos\w*|es seguro|tiene virus)\b/;
  const RE_LEER = /\b(lee\w*|leeme|contenido|que dice|que tiene|abre el (archivo|documento|txt))\b/;
  const RE_PREGUNTA = /\b(que es|que significa|como funciona|como se|para que sirve|por que|explica\w*|diferencia)\b/;
  const RE_CAPACIDAD = /\b(puedes|puede|sabes|sabe|eres capaz|se puede|es posible|podrias|podria|capaz)\b/;
  const RE_TODO = /\b(todo|todos|todas|cada uno|los archivos)\b/;
  const STOP = new Set(['documento', 'documentos', 'archivo', 'archivos', 'carpeta', 'copia', 'nuevo', 'nueva', 'final', 'texto', 'file']);

  function elegir(texto, archivos) {
    const u = ' ' + norm(texto) + ' ';
    const puntos = archivos.map(a => {
      const sinL = a.nombre.replace(/\.lyfan$/, '');
      const stem = norm(sinL.replace(/\.[^.]+$/, ''));
      const ext = (sinL.match(/\.([^.]+)$/) || [])[1];
      const toks = stem.split(' ').filter(t => t.length >= 3 && !STOP.has(t));
      let p = toks.filter(t => u.includes(' ' + t) || u.includes(t + ' ')).length;
      if (p === 0 && toks.length === 0 && stem && u.includes(' ' + stem)) p = 1;
      if (ext && new RegExp('(^| )' + ext.toLowerCase() + '( |$)').test(u)) p += 0.5;
      return { a, p };
    }).filter(x => x.p > 0).sort((x, y) => y.p - x.p);
    if (!puntos.length) return [];
    return puntos.filter(x => x.p === puntos[0].p).map(x => x.a);
  }
  const quitar = n => n.replace(/\.lyfan$/, '');
  const lista = arr => arr.slice(0, 5).map(a => quitar(a.nombre)).join(', ') + (arr.length > 5 ? '…' : '');
  const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  // Lo último que se hizo, para entender «vuélvelo a cifrar», «descífralo», «otra vez»
  let ultimos = [];
  const base = nombre => quitar(nombre).toLowerCase();
  const RE_PRONOMBRE = /\b(\w+(?:lo|la|los|las)|otra vez|de nuevo|nuevamente|ese|esa|este|esta|eso|esto)\b/;
  const RE_CAMBIAR_CLAVE = /\b(cambia\w*|cambio|cambiar|nueva|otra|modifica\w*|renueva\w*)\b.*\b(contrasena|clave)\b|\b(contrasena|clave)\b.*\b(cambia\w*|cambiar|nueva)\b/;

  // ---------------------------------------------------------------- antivirus y cuarentena
  const RE_CUARENTENA = /\b(cuarentena|aisla\w*|aislar)\b/;
  const RE_SACAR = /\b(saca\w*|quita\w*|restaura\w*|devuelve\w*|devuelvel\w*|recupera\w*|libera\w*)\b|\bfalsa alarma\b/;
  const RE_BORRAR_Q = /\b(elimina\w*|borra\w*|destruye\w*)\b/;
  const RE_VER_Q = /\b(que hay|que tienes|que tenemos|muestra\w*|lista\w*|cuales|ver)\b/;
  const RE_ESCANEO = /\b(escanea\w*|escaneo|analiza\w*|revisa\w*|busca\w*)\b.*\b(carpeta|boveda|todo|todos|archivos|virus|amenazas|malware)\b|\b(antivirus|escaneo completo|busca virus)\b/;
  const RE_CAPAZ_AV = /\b(que (archivos|tipos)|que puedes (revisar|analizar)|que revisas|que analizas)\b/;
  async function postJ(ruta, cuerpo) {
    const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No pude completar la acción.'); return j;
  }
  function elegirEn(lista, texto) {                       // busca en la cuarentena por nombre
    const u = ' ' + norm(texto) + ' ';
    const p = lista.map(e => ({ e, p: norm(e.nombre.replace(/\.[^.]+$/, '')).split(' ').filter(t => t.length >= 3 && !STOP.has(t)).filter(t => u.includes(' ' + t)).length })).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
    return p.length ? p[0].e : null;
  }
  const resumenHallazgo = h => `${h.nombre}${h.deteccion ? ' (' + h.deteccion.replace(' (heurístico)', '') + ')' : ''}`;

  async function comandoAntivirus(texto, n) {
    if (RE_CAPAZ_AV.test(n) && !RE_CUARENTENA.test(n)) return null;      // lo explica el modelo
    if (RE_CUARENTENA.test(n)) {
      const lista = (await (await fetch('/api/cuarentena')).json()).elementos || [];
      if (RE_SACAR.test(n)) {
        const e = elegirEn(lista, texto) || (lista.length === 1 ? lista[0] : null);
        if (!lista.length) return 'No hay nada en cuarentena, señor.';
        if (!e) return `¿Cuál saco de cuarentena? Tengo: ${lista.slice(0, 5).map(x => x.nombre).join(', ')}.`;
        const r = await postJ('/api/cuarentena/restaurar', { id: e.id });
        return `Listo, devolví ${r.restaurado} a su carpeta y lo marqué como falsa alarma: no lo volveré a señalar.`;
      }
      if (RE_BORRAR_Q.test(n)) {
        if (!lista.length) return 'La cuarentena está vacía, señor.';
        const e = elegirEn(lista, texto);
        const cuales = e ? [e] : RE_TODO.test(n) ? lista : (lista.length === 1 ? lista : null);
        if (!cuales) return `¿Cuál elimino? Tengo: ${lista.slice(0, 5).map(x => x.nombre).join(', ')}. También puede decir «elimina todo de la cuarentena».`;
        for (const x of cuales) await postJ('/api/cuarentena/eliminar', { id: x.id });
        return cuales.length === 1 ? `Eliminé ${cuales[0].nombre} para siempre.` : `Eliminé ${cuales.length} archivos de la cuarentena para siempre.`;
      }
      if (RE_VER_Q.test(n) && !/\b(pon\w*|mete\w*|manda\w*|mueve\w*)\b/.test(n)) {
        if (!lista.length) return 'La cuarentena está vacía, señor. Todo en orden.';
        return `En cuarentena tengo ${lista.length === 1 ? '1 archivo' : lista.length + ' archivos'}: ${lista.slice(0, 5).map(resumenHallazgo).join(', ')}. Puede decirme «sácalo de cuarentena» si fue falsa alarma.`;
      }
      // poner en cuarentena
      let est; try { est = await api(''); } catch { return null; }
      const sin = (est.archivos || []).filter(a => !a.cifrado);
      let objetivo = elegir(texto, sin);
      if (!objetivo.length && ultimos.length) objetivo = sin.filter(a => ultimos.includes(base(a.nombre)));
      if (!objetivo.length) return sin.length ? `¿Qué archivo pongo en cuarentena? Tiene: ${lista && sin.slice(0, 5).map(a => a.nombre).join(', ')}.` : 'No hay archivos sin cifrar para aislar, señor.';
      if (objetivo.length > 1 && !RE_TODO.test(n)) return `Hay varios que coinciden: ${objetivo.slice(0, 5).map(a => a.nombre).join(', ')}. ¿Cuál de ellos?`;
      const hechos = [];
      for (const a of objetivo) { try { await postJ('/api/cuarentena/poner', { nombre: a.nombre }); hechos.push(a.nombre); } catch { /* sigue */ } }
      if (!hechos.length) return 'No pude ponerlo en cuarentena, señor.';
      return `Listo, aislé ${hechos.join(', ')} en cuarentena: ya no puede abrirse ni ejecutarse. Si fue una falsa alarma, dígame «sácalo de cuarentena».`;
    }
    if (RE_ESCANEO.test(n) && !elegir(texto, ((await api('').catch(() => ({}))).archivos || [])).length) {
      if (App.poseTarea) App.poseTarea('scan');
      const r = await postJ('/api/antivirus/escanear', { solo_nuevos: false });
      if (App.poseTarea) App.poseTarea(null);
      if (!r.hallazgos.length) return `Escaneo completo: revisé ${r.total} ${r.total === 1 ? 'archivo' : 'archivos'} de su bóveda y no encontré amenazas.`;
      ultimos = r.hallazgos.map(h => base(h.nombre));
      return `[ALERTA] Escaneo completo: encontré ${r.hallazgos.length === 1 ? 'algo que requiere atención' : r.hallazgos.length + ' archivos que requieren atención'}: ${r.hallazgos.slice(0, 3).map(resumenHallazgo).join(', ')}. ¿Los pongo en cuarentena?`;
    }
    return null;
  }

  /** Devuelve lo que LyFan responde (y abre la pantalla si hace falta), o null si no era un pedido sobre la bóveda. */
  async function comando(texto) {
    const n = norm(texto);
    if (!n || n.length > 240) return null;
    try { const av = await comandoAntivirus(texto, n); if (av !== null) return av; } catch (e) { return 'No pude completar eso: ' + e.message; }
    if (/\bcontrasena\b.*\b(es|son)\b\s+\S+/.test(n) && /\b(boveda|maestra|clave)\b/.test(n))
      return 'Señor, no me diga su contraseña ni por voz ni por escrito. Escríbala solo en la ventana de la bóveda.';
    if (RE_CAMBIAR_CLAVE.test(n) && /\b(boveda|maestra|cambia\w*|cambiar)\b/.test(n) && !RE_PREGUNTA.test(n)) {
      abrirPantalla({ accion: 'cambiar' });
      return 'Claro. En la pantalla escriba primero su contraseña actual y luego la nueva. Su bóveda usa una sola contraseña para todos los archivos.';
    }
    let est;
    try { est = await api(''); } catch { return null; }
    const archivos = est.archivos || [];
    const sin = archivos.filter(a => !a.cifrado), con = archivos.filter(a => a.cifrado);

    const hablaDeBoveda = /\b(boveda|carpeta)\b/.test(n);
    const nv = n.replace(/\b(?:des)?(?:cifr|encript|encrip|protegid)\w*(?:ado|ada|ados|adas|ido|idos)\b/g, ' ');   // «cifrados» no es una orden
    const descifrar = RE_DESCIFRAR.test(nv);
    const cifrar = !descifrar && RE_CIFRAR.test(nv);
    const bloquear = RE_BLOQUEAR.test(n) && !cifrar && !descifrar;
    let nombrados = elegir(texto, archivos);
    const usaPronombre = !nombrados.length && ultimos.length && RE_PRONOMBRE.test(n) && !RE_TODO.test(n);
    if (usaPronombre) nombrados = archivos.filter(a => ultimos.includes(base(a.nombre)));
    const todos = RE_TODO.test(n) && !nombrados.length;
    const analizar = RE_ANALIZAR.test(n) && !cifrar && !descifrar &&
      (hablaDeBoveda || nombrados.length || /\b(archivo|documento|script|bat|ps1|vbs|txt|exe)\b/.test(n)) &&
      !/\b(mensaje|enlace|link|correo|sms|whatsapp)\b/.test(n);
    const leer = RE_LEER.test(n) && nombrados.length > 0 && !cifrar && !descifrar && !analizar;
    const mostrar = !cifrar && !descifrar && !analizar && !leer && RE_MOSTRAR.test(n) && RE_ARCH.test(n) && !/\b(peligros\w*|malicios\w*|sospech\w*|virus|malware|estafa|riesgo|seguro|abrirlo|abrirla)\b/.test(n);
    if (!(cifrar || descifrar || analizar || leer || mostrar || bloquear)) return null;
    if (RE_PREGUNTA.test(n)) return null;                                   // «¿qué es cifrar?» lo responde el modelo
    if ((cifrar || descifrar || analizar) && RE_CAPACIDAD.test(n) && !nombrados.length && !todos) return null;   // «¿puedes cifrar archivos?» lo responde el modelo
    if ((cifrar || descifrar) && !(hablaDeBoveda || /\b(archivo|archivos|documento|documentos|foto|fotos|todo|todos|todas|lo|la|los|las)\b/.test(n) || nombrados.length || RE_PRONOMBRE.test(n))) return null;

    if (bloquear) { await api('/bloquear', {}); return 'Listo, su bóveda quedó bloqueada.'; }

    if (!est.creada) {                                                      // primera vez: LyFan pide crear la contraseña y luego sigue con lo pedido
      abrirPantalla({ accion: 'crear', reintentar: cifrar || analizar ? texto : null });
      return cifrar
        ? 'Claro, señor. Como es la primera vez, primero debe crear su contraseña maestra. Escríbala dos veces en la ventana que le abrí y, apenas la cree, cifro su archivo.'
        : 'Aún no tiene una bóveda, señor. Le abrí la pantalla para que cree su contraseña maestra.';
    }

    if (mostrar) {
      const filtro = /\b(cifrad\w*|encriptad\w*|protegid\w*|bloquead\w*)\b/.test(n) ? 'cifrados'
        : /\b(en claro|sin cifrar|sin encriptar|descifrad\w*|desprotegid\w*|abiertos)\b/.test(n) ? 'claro' : 'todos';
      abrirPantalla({ accion: 'mostrar', filtro });
      const cuenta = filtro === 'cifrados' ? con.length : filtro === 'claro' ? sin.length : archivos.length;
      const que = filtro === 'cifrados' ? 'cifrados' : filtro === 'claro' ? 'sin cifrar' : 'en total';
      return `Claro. Le muestro la bóveda en pantalla: ${cuenta === 0 ? 'no hay archivos' : pl(cuenta, 'archivo', 'archivos')} ${cuenta === 0 ? 'en ese filtro' : que}.`;
    }

    // ¿a qué archivo(s) se refiere?
    const conj = /(,| y | e | tambien | ademas )/.test(' ' + n + ' ');
    const pool = cifrar ? sin : descifrar ? con : leer ? sin : archivos.filter(a => !a.cifrado);
    let objetivo = nombrados.filter(a => pool.includes(a));
    if (nombrados.length && !objetivo.length) {
      const otro = nombrados[0];
      if (cifrar) return `${quitar(otro.nombre)} ya está cifrado, señor.`;
      if (descifrar) return `${quitar(otro.nombre)} ya está sin cifrar, señor.`;
      return `${quitar(otro.nombre)} está cifrado, señor. Descífrelo primero para revisarlo.`;
    }
    if (!objetivo.length) {
      if (todos) objetivo = pool;
      else if (pool.length === 1) objetivo = pool;
      else if (!pool.length) return cifrar ? 'No hay archivos sin cifrar en su bóveda, señor. Arrástrelos sobre mí o colóquelos en su carpeta de la bóveda.' : descifrar ? 'No hay archivos cifrados en su bóveda, señor.' : 'No hay archivos sin cifrar para revisar, señor.';
      else {
        abrirPantalla({ accion: 'mostrar', filtro: cifrar || analizar || leer ? 'claro' : 'cifrados' });
        return `¿Cuál de ellos, señor? Tiene: ${lista(pool)}. Puede decirme el nombre o «todos».`;
      }
    } else if (objetivo.length > 1 && !todos && !conj) {
      abrirPantalla({ accion: 'mostrar', filtro: cifrar || analizar || leer ? 'claro' : 'cifrados' });
      return `Hay varios que coinciden, señor: ${lista(objetivo)}. ¿Cuál de ellos?`;
    }
    const nombres = objetivo.map(a => a.nombre);
    ultimos = objetivo.map(a => base(a.nombre));
    const que = objetivo.length === 1 ? quitar(objetivo[0].nombre) : pl(objetivo.length, 'archivo', 'archivos');

    if (cifrar) {
      abrirPantalla({ accion: 'cifrar', nombres });
      return est.bloqueada
        ? `Claro. Para cifrar ${que}, escriba su contraseña en la ventana de la pantalla, señor.`
        : `Claro. Cifrando ${que}; verá que desaparece de la carpeta.`;
    }
    if (descifrar) {
      abrirPantalla({ accion: 'descifrar', nombres });
      return `Claro, señor. Introduzca la contraseña en la ventana para descifrar ${que}.`;
    }
    if (leer) { abrirPantalla({ accion: 'ver', nombres }); return `Aquí tiene el contenido de ${que}, señor.`; }
    abrirPantalla({ accion: 'analizar', nombres });
    return `Con gusto. Reviso ${que} en su equipo y le cuento qué encuentro.`;
  }

  // El escaneo automático le cuenta a la bóveda qué encontró, para entender «ponlo en cuarentena»
  function recordar(nombres) { ultimos = (nombres || []).map(base); }
  window.LyFanBoveda = { comando, abrirPantalla, recordar };
})();
