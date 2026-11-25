// Puente seguro entre la página (overlay.html) y el proceso principal de Electron.
// La página no tiene acceso a Node: solo a estas funciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyfanDesktop', {
  arrastrarInicio: () => ipcRenderer.send('arrastrar-inicio'),
  arrastrarMover: () => ipcRenderer.send('arrastrar-mover'),
  arrastrarFin: () => ipcRenderer.send('arrastrar-fin'),
  ignorarMouse: ignorar => ipcRenderer.send('ignorar-mouse', !!ignorar),
  ocultar: () => ipcRenderer.send('ocultar'),
  abrirBoveda: tarea => ipcRenderer.send('abrir-boveda', tarea || null),
  abrirPrincipal: () => ipcRenderer.send('abrir-principal'),
  ajustarTamano: (ancho, alto, escala, robot) => ipcRenderer.send('ajustar-tamano', ancho, alto, escala, robot),
  leerPortapapeles: () => ipcRenderer.invoke('leer-portapapeles'),
  alEnfocarEntrada: cb => ipcRenderer.on('enfocar-entrada', () => cb()),
  alMoverCursor: cb => ipcRenderer.on('cursor', (_e, x, y) => cb(x, y)),
  alAccion: cb => ipcRenderer.on('accion', (_e, nombre) => cb(nombre)),
  alCambiarVisibilidad: cb => ipcRenderer.on('visibilidad', (_e, visible) => cb(!!visible)),
});
