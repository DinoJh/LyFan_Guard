/* LyFan Guard · Bóveda: archivos cifrados con contraseña maestra.
   La contraseña se escribe solo aquí (nunca por voz ni chat) y viaja únicamente al servidor local. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const App = window.LyFanApp;
  let estado = null, sondeo = 0, ocupado = false;

  const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  function mensaje(t, tipo) { const e = $('bv-estado'); e.textContent = t || ''; e.className = 'aj-nota' + (tipo ? ' estado-' + tipo : ''); }

  async function api(ruta, cuerpo) {
    const r = await fetch('/api/boveda' + ruta, cuerpo === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No pude completar la acción.'); e.codigo = r.status; throw e; }
    return j;
  }

  // ---------------------------------------------------------------- pintar
  function pintar(e) {
    estado = e;
    $('bv-crear').hidden = e.creada;
    $('bv-bloqueada').hidden = !(e.creada && e.bloqueada);
    $('bv-abierta').hidden = !(e.creada && !e.bloqueada);
    const res = $('aj-res-boveda');
    if (res) res.textContent = !e.creada ? 'Aún sin crear' : e.bloqueada ? 'Bloqueada 🔒' : `Abierta · ${e.archivos.length} archivo(s)`;
    if (!e.creada || e.bloqueada) return;
    $('bv-carpeta').textContent = 'Carpeta: ' + e.carpeta + ` · se bloquea sola a los ${e.autobloqueo_min} min`;
    const ul = $('bv-lista'); ul.textContent = '';
    if (!e.archivos.length) { const li = document.createElement('li'); li.className = 'bv-vacio'; li.textContent = 'La bóveda está vacía, señor.'; ul.append(li); return; }
    for (const a of e.archivos) {
      const li = document.createElement('li'); li.className = 'bv-item';
      const ico = document.createElement('span'); ico.className = 'bv-cand'; ico.textContent = a.cifrado ? '🔒' : '📄';
      const nom = document.createElement('span'); nom.className = 'bv-nombre'; nom.textContent = a.nombre;
      const peso = document.createElement('small'); peso.textContent = (a.cifrado ? 'Cifrado · ' : 'Sin cifrar · ') + fmt(a.bytes); nom.append(peso);
      li.append(ico, nom);
      if (a.cifrado) li.append(boton('Descifrar', () => descifrarConModal([a.nombre])));
      else {
        li.append(boton('Cifrar', () => accion('/cifrar', a.nombre, 'Cifrado')));
        li.append(boton('Analizar', () => analizar(a.nombre)));
      }
      ul.append(li);
    }
  }
  function boton(texto, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mini'; b.textContent = texto; b.addEventListener('click', fn); return b; }

  async function refrescar() {
    try { pintar(await api('')); } catch { mensaje('No pude consultar la bóveda.', 'mal'); }
  }
  function abrir() {
    mensaje(''); refrescar().then(() => { if (estado && !estado.creada) crearBoveda(); });
    clearInterval(sondeo); sondeo = setInterval(() => { if ($('ajustes').hidden) clearInterval(sondeo); else refrescar(); }, 20000);
  }

  // ---------------------------------------------------------------- ventana central de la contraseña
  let cerrarVentana = null;
  const puntos = () => { const n = $('bvm-clave').value.length; $('bvm-digitos').textContent = '●'.repeat(Math.min(n, 28)) + (n > 28 ? '…' : ''); };
  $('bvm-clave').addEventListener('input', puntos);
  $('bvm-ver').addEventListener('click', () => {
    const ver = $('bvm-clave').type === 'password';
    $('bvm-clave').type = ver ? 'text' : 'password'; $('bvm-repite').type = ver ? 'text' : 'password'; $('bvm-ver').textContent = ver ? 'Ocultar' : 'Ver';
  });
  /** Muestra la ventana en el centro. `accion(clave)` valida/ejecuta: si lanza un error se muestra y la ventana sigue abierta. */
  function ventana({ titulo, texto, repetir = false, boton = 'Aceptar', accion }) {
    if (cerrarVentana) cerrarVentana(false);
    return new Promise(resolver => {
      const m = $('bv-modal'), clave = $('bvm-clave'), rep = $('bvm-repite'), err = $('bvm-error'), ok = $('bvm-ok');
      $('bvm-titulo').textContent = titulo; $('bvm-texto').textContent = texto; ok.textContent = boton; ok.disabled = false;
      clave.value = rep.value = ''; clave.type = rep.type = 'password'; $('bvm-ver').textContent = 'Ver'; err.textContent = ''; rep.hidden = !repetir; puntos();
      clave.autocomplete = repetir ? 'new-password' : 'current-password';
      m.hidden = false; setTimeout(() => clave.focus(), 40);
      let enCurso = false;
      const cerrar = bien => {
        m.hidden = true; clave.value = rep.value = ''; puntos(); cerrarVentana = null;
        $('bvm-form').onsubmit = null; $('bvm-cancel').onclick = null; document.removeEventListener('keydown', tecla, true); resolver(bien);
      };
      const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cerrar(false); } };
      document.addEventListener('keydown', tecla, true);
      cerrarVentana = cerrar;
      $('bvm-cancel').onclick = () => cerrar(false);
      $('bvm-form').onsubmit = async ev => {
        ev.preventDefault(); if (enCurso) return;
        err.textContent = '';
        if (repetir) {
          if (clave.value.length < 8) { err.textContent = 'Debe tener al menos 8 caracteres.'; return clave.focus(); }
          if (clave.value !== rep.value) { err.textContent = 'Las dos contraseñas no coinciden.'; return rep.focus(); }
        } else if (!clave.value) return clave.focus();
        enCurso = true; ok.disabled = true; const previo = ok.textContent; ok.textContent = 'Verificando…';
        try { await accion(clave.value); cerrar(true); }
        catch (e) { err.textContent = e.message || 'No pude completar la acción.'; clave.select(); ok.textContent = previo; ok.disabled = false; enCurso = false; }
      };
    });
  }

  function crearBoveda() {
    return ventana({
      titulo: 'Cree su contraseña maestra',
      texto: 'Con ella LyFan cifrará y descifrará sus archivos. Si la olvida, nadie podrá recuperarlos. Escríbala solo aquí, nunca por voz.',
      repetir: true, boton: 'Crear bóveda',
      accion: async c => { pintar(await api('/crear', { clave: c })); },
    }).then(ok => { if (ok) { mensaje('Bóveda creada. Recuerde su contraseña: no se puede recuperar.', 'ok'); App.decir('Su bóveda está lista, señor. Guarde bien su contraseña: no puedo recuperarla.'); } return ok; });
  }
  function pedirDesbloqueo(despues) {
    return ventana({
      titulo: 'Desbloquear la bóveda', texto: 'Escriba su contraseña maestra para continuar.', boton: 'Desbloquear',
      accion: async c => { pintar(await api('/desbloquear', { clave: c })); },
    }).then(ok => { if (ok && despues) despues(); return ok; });
  }
  /** Descifrar SIEMPRE pide la contraseña en esta ventana; solo si es correcta se abre el archivo. */
  function descifrarConModal(nombres) {
    const cuales = nombres.length === 1 ? nombres[0].replace(/\.lyfan$/, '') : `${nombres.length} archivos`;
    let resultado = null;
    return ventana({
      titulo: 'Descifrar', texto: `Escriba su contraseña maestra para descifrar ${cuales}.`, boton: 'Descifrar',
      accion: async c => { resultado = await api('/descifrar', { nombres, clave: c }); pintar(resultado); },
    }).then(ok => {
      if (!ok) { mensaje('No se descifró nada.'); return false; }
      const h = resultado.descifrados || [], f = resultado.fallos || [];
      const t = (h.length ? `Descifrado: ${h.join(', ')}. ` : '') + (f.length ? 'No pude con: ' + f.join('; ') : '');
      mensaje(t.trim(), f.length ? 'mal' : 'ok');
      App.decir(h.length ? `Listo, descifré ${h.length === 1 ? h[0] : h.length + ' archivos'}.` : 'No pude descifrar el archivo, señor.');
      return true;
    });
  }
  $('bv-crear-ok').addEventListener('click', crearBoveda);
  $('bv-abrir').addEventListener('click', () => pedirDesbloqueo());
  $('bv-bloquear').addEventListener('click', async () => { try { pintar(await api('/bloquear', {})); mensaje('Bóveda bloqueada.', 'ok'); } catch (e) { mensaje(e.message, 'mal'); } });

  // ---------------------------------------------------------------- cifrar / descifrar / analizar
  async function accion(ruta, nombre, hecho) {
    if (ocupado) return; ocupado = true; mensaje('Trabajando en ello…'); App.pose('scan');
    try {
      pintar(await api(ruta, { nombre, borrar_original: true }));
      mensaje(`${hecho}: ${nombre}`, 'ok');
      App.decir(`${hecho}, señor.`);
    } catch (e) {
      mensaje(e.message, 'mal');
      if (e.codigo === 423) { refrescar(); pedirDesbloqueo(() => accion(ruta, nombre, hecho)); }
    } finally { ocupado = false; setTimeout(() => App.pose('idle'), 1500); }
  }
  async function analizar(nombre) {
    mensaje('Revisando el archivo en su equipo…'); App.pose('scan');
    try {
      const r = await api('/analizar', { nombre });
      if (!r.revisable) { mensaje(r.mensaje); return; }
      const partes = [];
      if (r.sensibles.length) partes.push('Contiene: ' + r.sensibles.join('; ') + '.');
      if (r.estafa && r.estafa.nivel !== 'tranquilo') partes.push(`Señales de estafa (${r.estafa.nivel}): ${r.estafa.razones.slice(0, 2).join('; ')}.`);
      const texto = partes.length ? partes.join(' ') : 'No encontré datos sensibles ni señales de estafa.';
      mensaje(texto, partes.length ? 'mal' : 'ok');
      App.decir(partes.length ? 'Revisé el archivo, señor. ' + texto + ' Le recomiendo cifrarlo.' : 'Revisé el archivo y todo está en orden, señor.');
    } catch (e) { mensaje(e.message, 'mal'); } finally { setTimeout(() => App.pose('idle'), 1500); }
  }

  // ---------------------------------------------------------------- subir archivos (arrastrar y soltar o elegir)
  async function subir(archivos) {
    if (!estado || !estado.creada) {
      window.LyFanAjustes.abrir(); window.LyFanAjustes.ir('boveda');
      mensaje('Primero cree su bóveda; luego arrastre de nuevo sus archivos.');
      crearBoveda();
      return;
    }
    let ok = 0;
    for (const f of archivos) {
      mensaje(`Guardando ${f.name}…`);
      try {
        const r = await fetch('/api/boveda/subir?nombre=' + encodeURIComponent(f.name), { method: 'POST', body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No pude guardar ' + f.name);
        pintar(j); ok++;
      } catch (e) { mensaje(e.message, 'mal'); }
    }
    if (ok) {
      mensaje(`${ok} archivo(s) guardado(s) en la bóveda. Pulse «Cifrar» para protegerlos.`, 'ok');
      App.decir(`Guardé ${ok === 1 ? 'el archivo' : 'los archivos'} en su bóveda, señor. ¿Lo${ok === 1 ? '' : 's'} cifro?`);
    }
  }
  function mostrarBoveda() {
    window.LyFanAjustes.abrir(); window.LyFanAjustes.ir('boveda');
  }
  $('bv-elegir').addEventListener('click', () => $('bv-archivo').click());
  $('bv-archivo').addEventListener('change', e => { const a = [...e.target.files]; e.target.value = ''; if (a.length) subir(a); });

  const trae = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  let contador = 0;
  document.addEventListener('dragenter', e => { if (trae(e)) { contador++; document.body.classList.add('arrastrando-archivo'); e.preventDefault(); } });
  document.addEventListener('dragover', e => { if (trae(e)) e.preventDefault(); });
  document.addEventListener('dragleave', e => { if (trae(e) && --contador <= 0) { contador = 0; document.body.classList.remove('arrastrando-archivo'); } });
  document.addEventListener('drop', async e => {
    if (!trae(e)) return;
    e.preventDefault(); contador = 0; document.body.classList.remove('arrastrando-archivo');
    const archivos = [...e.dataTransfer.files].filter(f => f.size >= 0);
    if (!archivos.length) return;
    mostrarBoveda();
    if (!estado) { try { estado = await api(''); } catch { /* se avisa en subir */ } }
    subir(archivos);
  });


  // ---------------------------------------------------------------- comandos por voz o chat
  // «cifra la nota», «encripta todo», «qué hay en la bóveda», «descifra notas», «bloquea la bóveda», «analiza la carpeta».
  // La contraseña NUNCA se pide ni se acepta por aquí: si hace falta, se abre el panel para escribirla.
  const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  let pendiente = null;
  const RE_CIFRAR = /\b(cifr\w*|encript\w*|enkript\w*|protege\w*|asegura\w*|bloquea\w* el archivo)\b/;
  const RE_DESCIFRAR = /\b(descifr\w*|desencript\w*|desencrip\w*|desbloquea\w* el archivo|saca\w* (de|el|los)|recupera\w*)\b/;
  const RE_LISTAR = /\b(que hay|que tengo|que archivos|lista\w*|muestra\w*|ensena\w*|dime)\b.*\b(boveda|carpeta|archivos)\b|\bmis archivos\b/;
  const RE_BLOQUEAR = /\b(bloquea\w*|cierra\w*|guarda\w*)\b.*\bboveda\b/;
  const RE_ANALIZAR = /\b(analiza\w*|revisa\w*|escanea\w*|examina\w*)\b/;
  const RE_PREGUNTA = /\b(que es|que significa|como funciona|como se|para que sirve|por que|explica\w*|diferencia)\b/;
  const RE_TODO = /\b(todo|todos|todas|cada uno|los archivos|las cosas)\b/;

  function elegir(texto, archivos) {
    const u = ' ' + norm(texto) + ' ';
    const puntos = archivos.map(a => {
      const stem = norm(a.nombre.replace(/\.lyfan$/, '').replace(/\.[^.]+$/, ''));
      const ext = (a.nombre.replace(/\.lyfan$/, '').match(/\.([^.]+)$/) || [])[1];
      const toks = stem.split(' ').filter(t => t.length >= 3);
      let p = toks.filter(t => u.includes(' ' + t) || u.includes(t + ' ')).length;
      if (ext && new RegExp('\\b' + ext + '\\b').test(u)) p += 0.5;
      return { a, p };
    }).filter(x => x.p > 0).sort((x, y) => y.p - x.p);
    if (!puntos.length) return [];
    return puntos.filter(x => x.p === puntos[0].p).map(x => x.a);
  }
  const lista = arr => arr.slice(0, 6).map(a => a.nombre.replace(/\.lyfan$/, '')).join(', ') + (arr.length > 6 ? '…' : '');

  async function comando(texto) {
    const n = norm(texto);
    if (!n || n.length > 220) return null;
    if (/\bcontrasena\b.*\b(es|son)\b\s+\S+/.test(n) && /\b(boveda|maestra|clave)\b/.test(n))
      return 'Señor, no me diga su contraseña ni por voz ni por escrito aquí. Escríbala solo en el panel de la bóveda.';
    const hablaDeBoveda = /\b(boveda|carpeta)\b/.test(n);
    let est;
    try { est = await api(''); } catch { return null; }

    const cifrar = RE_CIFRAR.test(n), descifrar = RE_DESCIFRAR.test(n);
    const listar = RE_LISTAR.test(n) && hablaDeBoveda || /\bmis archivos\b/.test(n);
    const bloquear = RE_BLOQUEAR.test(n) && !cifrar;
    const nombrados = elegir(texto, est.archivos || []);
    const analizar = RE_ANALIZAR.test(n) && (hablaDeBoveda || (nombrados.length && /\barchivo\b/.test(n)) || (nombrados.length && !/\b(mensaje|texto|enlace|link|correo)\b/.test(n) && n.split(' ').length <= 8));
    if (!(cifrar || descifrar || listar || bloquear || analizar)) return null;
    if (RE_PREGUNTA.test(n)) return null;                                  // «¿qué es cifrar?» lo responde el modelo
    // un «cifra/encripta» suelto solo cuenta si habla de archivos, de la bóveda o nombra uno
    if ((cifrar || descifrar) && !(hablaDeBoveda || /\b(archivo|archivos|documento|documentos|foto|fotos|todo|todos|todas)\b/.test(n) || nombrados.length)) return null;

    if (!est.creada) { mostrarBoveda(); return 'Aún no tiene una bóveda, señor. Escriba su contraseña maestra en la ventana que le abrí.'; }
    if (bloquear) { pintar(await api('/bloquear', {})); return 'Listo, su bóveda quedó bloqueada.'; }
    if (est.bloqueada && cifrar && !descifrar) {
      pendiente = texto; pedirDesbloqueo(continuarPendiente);
      return 'Necesito que desbloquee la bóveda, señor. Escriba su contraseña en la ventana; no me la diga por voz. Apenas la abra, continúo.';
    }
    pintar(est);
    if (listar) {
      const a = est.archivos;
      if (!a.length) return 'Su bóveda está vacía, señor. Arrastre archivos sobre mí para guardarlos.';
      const c = a.filter(x => x.cifrado), s = a.filter(x => !x.cifrado);
      return `Tiene ${a.length} archivo${a.length === 1 ? '' : 's'}: ${c.length} cifrado${c.length === 1 ? '' : 's'} y ${s.length} sin cifrar.` + (s.length ? ` Sin cifrar: ${lista(s)}.` : '');
    }

    const todos = RE_TODO.test(n) && !nombrados.length;
    const sin = est.archivos.filter(x => !x.cifrado), con = est.archivos.filter(x => x.cifrado);
    const candidatos = descifrar ? con : sin;
    if (analizar && !cifrar && !descifrar) {
      const objetivo = nombrados.filter(x => !x.cifrado);
      const elegidos = objetivo.length ? objetivo : (todos || !nombrados.length ? sin : []);
      if (!elegidos.length) return 'No encuentro ese archivo sin cifrar, señor.';
      const lineas = [];
      for (const a of elegidos.slice(0, 5)) {
        try {
          const r = await api('/analizar', { nombre: a.nombre });
          if (!r.revisable) { lineas.push(`${a.nombre}: solo reviso archivos de texto.`); continue; }
          const partes = [...r.sensibles]; if (r.estafa && r.estafa.nivel !== 'tranquilo') partes.push('señales de estafa (' + r.estafa.nivel + ')');
          lineas.push(partes.length ? `${a.nombre}: ${partes.join(', ')}.` : `${a.nombre}: sin problemas.`);
        } catch (e) { lineas.push(`${a.nombre}: ${e.message}`); }
      }
      return 'Revisé sus archivos. ' + lineas.join(' ');
    }
    let objetivo = nombrados.filter(x => x.cifrado === !!descifrar);
    if (!objetivo.length) {
      if (todos) objetivo = candidatos;
      else if (nombrados.length) return `Ese archivo ya está ${descifrar ? 'sin cifrar' : 'cifrado'}, señor.`;
      else if (candidatos.length === 1) objetivo = candidatos;
      else if (!candidatos.length) return descifrar ? 'No hay archivos cifrados en su bóveda, señor.' : 'No hay archivos sin cifrar en su bóveda, señor.';
      else return `¿Cuál desea ${descifrar ? 'descifrar' : 'cifrar'}, señor? Tiene: ${lista(candidatos)}. Puede decirme «todos».`;
    }
    if (descifrar) {                                                       // descifrar siempre pide la contraseña en pantalla
      descifrarConModal(objetivo.map(a => a.nombre));
      return `Para descifrar ${objetivo.length === 1 ? objetivo[0].nombre.replace(/\.lyfan$/, '') : objetivo.length + ' archivos'}, escriba su contraseña en la ventana, señor. No me la diga por voz.`;
    }
    const hechos = [], fallos = [];
    for (const a of objetivo) {
      try { pintar(await api(descifrar ? '/descifrar' : '/cifrar', { nombre: a.nombre, borrar_original: true })); hechos.push(a.nombre.replace(/\.lyfan$/, '')); }
      catch (e) { fallos.push(`${a.nombre}: ${e.message}`); }
    }
    let r = hechos.length ? `Listo, ${descifrar ? 'descifré' : 'cifré'} ${hechos.length === 1 ? hechos[0] : hechos.length + ' archivos (' + lista(hechos.map(h => ({ nombre: h }))) + ')'}.` : '';
    if (fallos.length) r += (r ? ' ' : '') + 'No pude con: ' + fallos.join('; ');
    return r;
  }
  async function continuarPendiente() {
    if (!pendiente) return;
    const t = pendiente; pendiente = null;
    try { const r = await comando(t); if (r) { mensaje(r, 'ok'); App.decir(r); } } catch { /* se verá en el panel */ }
  }

  window.LyFanBoveda = { abrir, comando };
  refrescar();
})();
