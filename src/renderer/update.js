// Flujo de actualización: aviso → descarga con progreso → reiniciar e instalar.
// Nada se descarga ni se instala sin que el usuario lo acepte.
import { app, api, escapeHtml } from './app.js';

const SETTINGS_HINT = '<p class="modal-hint">Si ahora no quieres, puedes actualizar cuando quieras en <b>Ajustes → Actualizaciones</b>.</p>';

function notesHtml(notes) {
  if (!notes) return '';
  const text = notes.length > 600 ? `${notes.slice(0, 600)}…` : notes;
  return `<div class="modal-notes">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

function progressHtml(st) {
  const mb = (n) => (n / 1048576).toFixed(1);
  const detail = st.total ? `${mb(st.transferred || 0)} de ${mb(st.total)} MB` : 'Preparando…';
  return `<p>Descargando solo las partes que han cambiado.</p>
    <div class="progress modal-progress"><div style="width:${st.percent || 0}%"></div></div>
    <p class="modal-hint">${st.percent || 0}% · ${detail}</p>`;
}

// Aviso al arrancar cuando hay una versión nueva
export async function promptUpdate(st) {
  const choice = await app.openModal({
    title: `Hay una versión nueva de GameHub (${st.version})`,
    html: `<p>Tienes la versión ${escapeHtml(st.current || '')}. ¿Quieres actualizar ahora?</p>${notesHtml(st.notes)}${SETTINGS_HINT}`,
    buttons: [
      { id: 'update', label: 'Actualizar ahora' },
      { id: 'later', label: 'Ahora no' },
      { id: 'skip', label: 'Omitir esta versión' },
    ],
    cancel: 'later',
  }).result;
  if (choice === 'update') return downloadAndInstall();
  if (choice === 'skip') {
    await api.skipUpdate(st.version);
    app.toast(`No se volverá a avisar de la versión ${st.version}. Puedes instalarla en Ajustes → Actualizaciones`, { ms: 6000 });
  } else if (choice === 'later') {
    app.toast('Puedes actualizar cuando quieras en Ajustes → Actualizaciones', { ms: 5000 });
  }
}

// Descarga mostrando el progreso y, al terminar, pregunta si reiniciar
export async function downloadAndInstall() {
  const modal = app.openModal({
    title: 'Descargando actualización',
    html: progressHtml(app.updateState),
    buttons: [{ id: 'background', label: 'Seguir en segundo plano' }],
    cancel: 'background',
  });
  const off = api.onUpdateState((st) => {
    if (st.status === 'downloading') modal.setHtml(progressHtml(st));
    if (st.status === 'downloaded') modal.close('done');
    if (st.status === 'error') modal.close('error');
  });
  api.downloadUpdate();
  const result = await modal.result;
  off();
  if (result === 'background') {
    app.toast('La descarga sigue en segundo plano. Ajustes → Actualizaciones', { ms: 5000 });
    return;
  }
  if (result === 'error') {
    app.toast(`No se pudo descargar la actualización: ${app.updateState.error || ''}`, { error: true, ms: 7000 });
    return;
  }
  return confirmInstall();
}

export async function confirmInstall() {
  const choice = await app.openModal({
    title: 'Actualización lista',
    html: `<p>La versión ${escapeHtml(app.updateState.version || '')} está descargada. GameHub se cerrará, se instalará y volverá a abrirse solo.</p>
      <p class="modal-hint">Si eliges "Más tarde", podrás instalarla en <b>Ajustes → Actualizaciones</b>.</p>`,
    buttons: [{ id: 'install', label: 'Reiniciar e instalar' }, { id: 'later', label: 'Más tarde' }],
    cancel: 'later',
  }).result;
  if (choice === 'install') api.installUpdate();
}
