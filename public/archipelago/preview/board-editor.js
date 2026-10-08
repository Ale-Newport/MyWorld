import { BOARD_DEFAULTS, BOARD_MOTIONS, resolveBoard, paintExperiment } from './portfolio/world2/content/boards.js';
import { paintProjectScreen } from './portfolio/world2/interactions/screenMotion.js';

/** Admin-only editor. Images are resized before entering the existing world draft. */
export function installBoardEditor(editor) {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'board-editor.css'; document.head.append(style);
  const button = document.createElement('button'); button.id = 'edit-boards'; button.textContent = 'Carteles';
  document.querySelector('header nav').append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'board-editor';
  dialog.innerHTML = `<form><h2>Carteles del mundo</h2><p>Edita las fichas de Projects y Next experience (Next experiment). Después, guarda el borrador y publícalo desde Admin World.</p>
    <div class="board-fields"><label>Cartel<select name="kind"><option value="projects">Projects</option><option value="experiments">Next experience / Experiments</option></select></label><label>Ficha<select name="entry"></select></label></div>
    <canvas width="1024" height="512" aria-label="Vista previa del cartel"></canvas><div class="board-fields" data-fields></div>
    <label>Imagen o ilustración propia<input name="upload" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="board-image-help">PNG, JPG o WebP · máximo 10 MB. Se optimiza automáticamente.</p>
    <div class="board-actions"><button type="button" data-remove>Quitar imagen</button><button type="button" data-reset>Restablecer ficha</button></div>
    <p role="status" aria-live="polite"></p><footer><button type="button" data-cancel>Cancelar</button><button type="submit">Aplicar cambios</button></footer></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), kind = form.elements.kind, entry = form.elements.entry, upload = form.elements.upload;
  const fields = dialog.querySelector('[data-fields]'), canvas = dialog.querySelector('canvas'), status = dialog.querySelector('[role=status]');
  let draft, pending = 0, generation = 0;
  const controls = {};
  const definitions = [['title','Título',120],['short','Título corto',120],['description','Descripción',500],['category','Categoría',120],['year','Año',120],['technologies','Tecnologías (separadas por comas)',250],['metric','Dato destacado (opcional)',120],['link','Enlace (https://)',2048],['linkLabel','Texto del enlace',120]];
  const current = () => resolveBoard(draft, kind.value).find(p => p.id === entry.value);
  const override = () => { draft[kind.value] ??= {}; return draft[kind.value][entry.value] ??= {}; };
  const preview = () => {
    if (!dialog.open) return;
    const item = current(), context = canvas.getContext('2d'); if (!item) return;
    if (kind.value === 'projects') paintProjectScreen(context, 1024, 512, item, 2);
    else paintExperiment(context, item, entry.selectedIndex, entry.options.length, preview);
    // Project images load asynchronously; paint once again when decoded.
    if (item.image && kind.value === 'projects') { const im = new Image(); im.onload = () => { if (dialog.open && current()?.image === item.image) paintProjectScreen(context, 1024, 512, current(), 2); }; im.src = item.image; }
  };
  for (const [key, title, max] of definitions) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(key === 'description' ? 'textarea' : 'input'); input.name = key; input.maxLength = max;
    if (key === 'link') input.type = 'url';
    label.append(input); fields.append(label); controls[key] = input;
    input.addEventListener('input', () => { override()[key] = key === 'technologies' ? input.value.split(',').map(s => s.trim()).filter(Boolean) : input.value; preview(); });
  }
  const motionLabel = document.createElement('label'); motionLabel.textContent = 'Ilustración animada';
  const motion = document.createElement('select'); motion.name = 'motion';
  const names = ['Ajedrez','Mercado','Órbitas','Entrenamiento','Pipeline','Túnel','Timeline','Laberinto','Anillos'];
  BOARD_MOTIONS.forEach((value, i) => motion.add(new Option(names[i], value))); motionLabel.append(motion); fields.append(motionLabel);
  motion.onchange = () => { override().motion = motion.value; override().image = ''; preview(); };
  const fill = () => {
    const item = current();
    for (const [key] of definitions) { controls[key].value = key === 'technologies' ? item[key].join(', ') : item[key] ?? ''; controls[key].parentElement.hidden = kind.value === 'experiments' && ['short','category','metric','link','linkLabel'].includes(key); }
    motionLabel.hidden = kind.value !== 'projects'; motion.value = BOARD_MOTIONS.includes(item.motion) ? item.motion : 'PrimesMotion';
    upload.value = ''; status.textContent = ''; preview();
  };
  const entries = () => { entry.replaceChildren(...BOARD_DEFAULTS[kind.value].map(p => new Option(p.title, p.id))); fill(); };
  kind.onchange = entries; entry.onchange = fill;
  button.onclick = () => {
    if (!editor.enabled) { editor.notify('Vuelve a 3D EDIT para modificar los carteles.'); return; }
    draft = structuredClone(editor.root.userData.worldBoards ?? {}); generation++; dialog.showModal(); entries();
  };
  dialog.querySelector('[data-remove]').onclick = () => { override().image = ''; preview(); };
  dialog.querySelector('[data-reset]').onclick = () => { if (draft[kind.value]) delete draft[kind.value][entry.value]; fill(); };
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { generation++; });
  for (const type of ['keydown','keyup']) dialog.addEventListener(type, e => e.stopPropagation());
  upload.onchange = async () => {
    const file = upload.files[0]; if (!file) return;
    const target = override(), version = generation;
    pending++; form.querySelector('[type=submit]').disabled = true;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const image = document.createElement('canvas'); image.width = Math.max(1, Math.round(bitmap.width * scale)); image.height = Math.max(1, Math.round(bitmap.height * scale));
      image.getContext('2d').drawImage(bitmap, 0, 0, image.width, image.height); bitmap.close();
      const data = image.toDataURL('image/webp', .82);
      if (data.length > 1_500_000) throw new Error('La imagen es demasiado grande; usa una versión más pequeña.');
      if (version !== generation) return;
      target.image = data; status.textContent = 'Imagen lista. Pulsa Aplicar cambios para incorporarla al borrador.'; preview();
    } catch (error) { if (version === generation) status.textContent = error.message; }
    finally { pending--; form.querySelector('[type=submit]').disabled = pending > 0; }
  };
  form.onsubmit = e => {
    e.preventDefault(); if (pending || !form.reportValidity()) return;
    // Resolve every entry before storing, keeping imported/legacy values bounded.
    const normalized = {};
    for (const group of ['projects','experiments']) normalized[group] = Object.fromEntries(resolveBoard(draft, group).map(p => [p.id, p]));
    editor.mutate(() => { editor.root.userData.worldBoards = normalized; });
    dialog.close(); editor.notify('Carteles actualizados. Prueba DRIVE; guarda el borrador y publica para mostrarlos en /world.');
  };
}
