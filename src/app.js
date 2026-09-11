'use strict';

const PHYSICAL_SLOTS = self.MWU1.PHYSICAL_SLOTS;
const FILAMENT_TYPES = self.MWU1.FILAMENT_PROFILES;
const PRINT_PROFILES = self.MWU1.U1_PROCESS_PROFILES;
const PRESET_COLORS = [
  '#FFFFFF', '#F5F5F5', '#CCCCCC', '#AAAAAA', '#888888', '#555555', '#333333', '#000000',
  '#FF0000', '#CC0000', '#880000', '#FF4444', '#FF6B6B', '#E74C3C', '#C0392B', '#8B0000',
  '#FF6600', '#FF8800', '#FFAA00', '#FFD700', '#FFFF00', '#FFC107', '#F39C12', '#E67E22',
  '#00FF00', '#00CC00', '#008800', '#27AE60', '#2ECC71', '#1ABC9C', '#006400', '#228B22',
  '#00FFFF', '#00CCFF', '#0088FF', '#0000FF', '#0000CC', '#000088', '#3498DB', '#2980B9',
  '#FF00FF', '#FF69B4', '#FF1493', '#E91E63', '#9B59B6', '#8E44AD', '#4B0082', '#800080',
  '#8B4513', '#A0522D', '#D2691E', '#CD853F', '#DEB887', '#C9A84C', '#B8860B', '#DAA520',
];

const state = {
  settings: null,
  currentBytes: null,
  sourcePath: null,
  sourceKind: 'manual',
  originalName: 'modelo',
  parsedZip: null,
  analysis: null,
  inputFilaments: [],
  outputSlots: [],
  mapping: {},
  processProfileId: 'standard',
  savedPath: null,
  verification: null,
  colorPopover: null,
  activeColorSlot: null,
};

const $ = id => document.getElementById(id);
const views = ['drop-state', 'loading-state', 'error-state', 'already-state', 'converter-state', 'success-state'];

function showView(id) {
  for (const view of views) $(view).classList.toggle('hidden', view !== id);
}

function baseName(filename) {
  return String(filename || 'modelo').replace(/\.3mf$/i, '');
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value?.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
  }
  return new Uint8Array(value);
}

function exactArrayBuffer(bytes) {
  const value = toUint8Array(bytes);
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function showError(message) {
  closeColorPopover();
  $('error-message').textContent = message || 'Ocurrió un error inesperado.';
  showView('error-state');
}

function setLoading(title, detail) {
  $('loading-title').textContent = title;
  $('loading-detail').textContent = detail;
  showView('loading-state');
}

function resetApp() {
  closeColorPopover();
  state.currentBytes = null;
  state.sourcePath = null;
  state.sourceKind = 'manual';
  state.originalName = 'modelo';
  state.parsedZip = null;
  state.analysis = null;
  state.inputFilaments = [];
  state.outputSlots = [];
  state.mapping = {};
  state.processProfileId = 'standard';
  state.savedPath = null;
  state.verification = null;
  $('slot-warning').classList.add('hidden');
  $('orca-error').classList.add('hidden');
  showView('drop-state');
}

function updateWatchStatus() {
  const pill = $('watch-status');
  const enabled = Boolean(state.settings?.watchEnabled);
  pill.classList.toggle('status-on', enabled);
  pill.classList.toggle('status-off', !enabled);
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  const label = document.createTextNode(enabled
    ? `Vigilando: ${state.settings.watchFolder}`
    : 'Vigilancia desactivada');
  pill.replaceChildren(dot, label);
  pill.title = enabled ? state.settings.watchFolder : '';
}

async function detectFormat(zip) {
  const names = Object.keys(zip.files);
  if (names.some(name => /Metadata\/(?:Slic3r_PE(?:_model)?|PrusaSlicer)\.config$/i.test(name))) {
    return 'PrusaSlicer / SuperSlicer';
  }
  if (zip.file('Metadata/slice_info.config') || zip.file('Metadata/project_settings.config')) {
    return 'Bambu Studio / OrcaSlicer';
  }
  const model = zip.file('3D/3dmodel.model');
  if (model) {
    const bytes = await model.async('uint8array');
    const header = new TextDecoder('utf-8').decode(bytes.subarray(0, 100000));
    if (/<basematerials[\s>]/i.test(header)) return '3MF estándar';
  }
  return '3MF genérico';
}

function mapFilamentType(original) {
  const upper = String(original || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper.includes('PETG')) return 'PETG-HF';
  if (upper.includes('ABS')) return 'ABS';
  if (upper.includes('TPU') || upper.includes('FLEX')) return 'TPU';
  return 'PLA';
}

async function processPayload(payload) {
  if (!payload?.data) return;
  setLoading('Analizando archivo…', 'Leyendo el modelo, los materiales y las asignaciones de color.');
  try {
    const bytes = toUint8Array(payload.data);
    state.currentBytes = new Uint8Array(bytes);
    state.sourcePath = payload.path || null;
    state.sourceKind = payload.source || 'manual';
    state.originalName = baseName(payload.name || 'modelo.3mf');

    const analysis = await self.MWU1.analyze(exactArrayBuffer(bytes));
    const format = await detectFormat(analysis.zip);
    if (format === '3MF genérico' && analysis.filaments.length === 1) {
      analysis.filaments[0].type = state.settings.defaultFilamentType;
    }

    state.parsedZip = analysis.zip;
    state.analysis = analysis;
    state.analysis.format = format;

    if (analysis.isAlreadyU1) {
      showView('already-state');
      return;
    }

    initializeMapping(analysis.filaments);
    renderConverter();
    showView('converter-state');

    if (state.sourceKind === 'watcher' && state.settings.autoConvertSingleColor && analysis.filaments.length === 1) {
      await convertAndSave(true);
    }
  } catch (error) {
    showError(error.message || 'El archivo no parece ser un 3MF válido.');
  }
}

function initializeMapping(filaments) {
  state.inputFilaments = filaments.map(filament => ({ ...filament }));
  state.outputSlots = filaments.map(filament => ({
    color: self.MWU1.normalizeColor(filament.color),
    type: mapFilamentType(filament.type),
  }));
  state.mapping = {};
  filaments.forEach((filament, index) => {
    state.mapping[filament.id] = index;
  });
}

function usedSlots() {
  return new Set(Object.values(state.mapping));
}

function updateLimitWarning() {
  const used = usedSlots();
  const warning = $('slot-warning');
  const convertButton = $('btn-convert');
  if (used.size > PHYSICAL_SLOTS) {
    warning.textContent = `La U1 admite 4 filamentos físicos. Actualmente hay ${used.size} ranuras en uso. Reasigná los colores adicionales a una de las cuatro primeras ranuras.`;
    warning.classList.remove('hidden');
    convertButton.disabled = true;
  } else {
    warning.classList.add('hidden');
    convertButton.disabled = used.size === 0;
  }
}

function renderConverter() {
  $('file-name').textContent = `${state.originalName}.3mf`;
  $('file-path').textContent = state.sourcePath || 'Archivo seleccionado manualmente';
  $('format-badge').textContent = state.analysis.format;
  $('support-badge').classList.toggle('hidden', !state.analysis.hasSupport);
  buildProcessProfiles();
  buildSlots();
  buildInputs();
  updateLimitWarning();
}

function buildProcessProfiles() {
  const container = $('process-options');
  container.replaceChildren();
  for (const profile of PRINT_PROFILES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'process-option';
    button.setAttribute('aria-pressed', String(state.processProfileId === profile.id));
    if (state.processProfileId === profile.id) button.classList.add('active');

    const label = document.createElement('strong');
    label.textContent = profile.label;
    const layer = document.createElement('span');
    layer.textContent = `${profile.layer_height} · boquilla 0,4 mm`;
    const description = document.createElement('small');
    description.textContent = profile.description;
    button.append(label, layer, description);
    button.addEventListener('click', () => {
      state.processProfileId = profile.id;
      buildProcessProfiles();
    });
    container.appendChild(button);
  }
}

function reorderSlot(from, to) {
  if (from === to || from < 0 || to < 0) return;
  const [moved] = state.outputSlots.splice(from, 1);
  state.outputSlots.splice(to, 0, moved);
  for (const id of Object.keys(state.mapping)) {
    const old = state.mapping[id];
    if (old === from) state.mapping[id] = to;
    else if (from < to && old > from && old <= to) state.mapping[id] = old - 1;
    else if (from > to && old >= to && old < from) state.mapping[id] = old + 1;
  }
  renderConverter();
}

function buildSlots() {
  const strip = $('slots-strip');
  strip.replaceChildren();
  const used = usedSlots();

  state.outputSlots.forEach((slot, index) => {
    const card = document.createElement('div');
    card.className = 'printer-slot';
    if (!used.has(index)) card.classList.add('unused');
    if (used.has(index) && index >= PHYSICAL_SLOTS) card.classList.add('over-limit');
    card.draggable = true;
    card.dataset.index = index;

    const top = document.createElement('div');
    top.className = 'slot-top';
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Arrastrar para reordenar';
    const number = document.createElement('span');
    number.className = 'slot-number';
    number.textContent = `RANURA ${index + 1}`;
    const remove = document.createElement('button');
    remove.className = 'slot-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Eliminar ranura';
    remove.disabled = state.outputSlots.length <= 1;
    remove.addEventListener('click', () => removeSlot(index));
    top.append(handle, number, remove);

    const color = document.createElement('button');
    color.className = 'slot-color';
    color.type = 'button';
    color.style.background = slot.color;
    color.title = `Cambiar color ${slot.color}`;
    color.addEventListener('click', () => openColorPopover(index, color));

    const select = document.createElement('select');
    select.className = 'slot-type';
    select.setAttribute('aria-label', `Material de ranura ${index + 1}`);
    for (const profile of FILAMENT_TYPES) {
      const option = document.createElement('option');
      option.value = profile.type;
      option.textContent = profile.type;
      option.selected = profile.type === slot.type;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      state.outputSlots[index].type = select.value;
    });

    card.append(top, color, select);
    if (!used.has(index)) {
      const unused = document.createElement('span');
      unused.className = 'unused-label';
      unused.textContent = 'Sin asignar';
      card.appendChild(unused);
    }

    card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', event => {
      event.preventDefault();
      card.classList.add('drag-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
    card.addEventListener('drop', event => {
      event.preventDefault();
      card.classList.remove('drag-target');
      reorderSlot(Number(event.dataTransfer.getData('text/plain')), index);
    });

    strip.appendChild(card);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add-slot';
  add.textContent = '+ Agregar';
  add.addEventListener('click', () => {
    state.outputSlots.push({ color: '#FFFFFF', type: state.settings.defaultFilamentType });
    renderConverter();
  });
  strip.appendChild(add);
}

function removeSlot(index) {
  if (state.outputSlots.length <= 1) return;
  state.outputSlots.splice(index, 1);
  for (const id of Object.keys(state.mapping)) {
    if (state.mapping[id] === index) state.mapping[id] = 0;
    else if (state.mapping[id] > index) state.mapping[id] -= 1;
  }
  renderConverter();
}

function buildInputs() {
  const list = $('input-list');
  list.replaceChildren();

  for (const filament of state.inputFilaments) {
    const row = document.createElement('div');
    row.className = 'input-row';

    const dot = document.createElement('span');
    dot.className = 'input-color';
    dot.style.background = filament.color;

    const name = document.createElement('div');
    name.className = 'input-name';
    const strong = document.createElement('strong');
    strong.textContent = filament.type || 'Material desconocido';
    const code = document.createElement('small');
    code.textContent = `${filament.color} · ID ${filament.id}`;
    name.append(strong, code);

    const arrow = document.createElement('span');
    arrow.className = 'route-arrow';
    arrow.textContent = '→';

    const choices = document.createElement('div');
    choices.className = 'slot-selector';
    state.outputSlots.forEach((slot, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-choice';
      if (state.mapping[filament.id] === index) button.classList.add('active');
      button.title = `Asignar a ranura ${index + 1}`;
      const color = document.createElement('span');
      color.className = 'slot-choice-color';
      color.style.background = slot.color;
      const number = document.createElement('span');
      number.className = 'slot-choice-number';
      number.textContent = String(index + 1);
      button.append(color, number);
      button.addEventListener('click', () => {
        state.mapping[filament.id] = index;
        renderConverter();
      });
      choices.appendChild(button);
    });

    row.append(dot, name, arrow, choices);
    list.appendChild(row);
  }
}

function closeColorPopover() {
  state.colorPopover?.remove();
  state.colorPopover = null;
  state.activeColorSlot = null;
}

function applyColor(value) {
  if (state.activeColorSlot === null) return;
  const normalized = self.MWU1.normalizeColor(value);
  state.outputSlots[state.activeColorSlot].color = normalized;
  closeColorPopover();
  renderConverter();
}

function openColorPopover(index, anchor) {
  closeColorPopover();
  state.activeColorSlot = index;
  const current = state.outputSlots[index].color;
  const popover = document.createElement('div');
  popover.className = 'color-popover';

  const preview = document.createElement('div');
  preview.className = 'color-preview';
  preview.style.background = current;

  const hexRow = document.createElement('div');
  hexRow.className = 'hex-row';
  const hash = document.createElement('span');
  hash.textContent = '#';
  const input = document.createElement('input');
  input.maxLength = 6;
  input.value = current.replace('#', '');
  input.setAttribute('aria-label', 'Color hexadecimal');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^0-9a-f]/gi, '').slice(0, 6);
    if (input.value.length === 6) preview.style.background = `#${input.value}`;
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && input.value.length === 6) applyColor(`#${input.value}`);
    if (event.key === 'Escape') closeColorPopover();
  });
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'hex-apply';
  apply.textContent = 'Aplicar';
  apply.addEventListener('click', () => {
    if (input.value.length === 6) applyColor(`#${input.value}`);
  });
  hexRow.append(hash, input, apply);

  const presets = document.createElement('div');
  presets.className = 'preset-grid';
  for (const preset of PRESET_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-color';
    if (preset === current) button.classList.add('active');
    button.style.background = preset;
    button.title = preset;
    button.addEventListener('click', () => applyColor(preset));
    presets.appendChild(button);
  }

  popover.append(preview, hexRow, presets);
  document.body.appendChild(popover);
  state.colorPopover = popover;

  const rect = anchor.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 292);
  const below = rect.bottom + 8;
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = `${below}px`;
  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    if (popRect.bottom > window.innerHeight - 8) {
      popover.style.top = `${Math.max(8, rect.top - popRect.height - 8)}px`;
    }
    input.focus();
    input.select();
  });
}

function conversionConfiguration() {
  const used = usedSlots();
  if (used.size === 0) throw new Error('No hay ranuras asignadas.');
  if (used.size > PHYSICAL_SLOTS) throw new Error('La U1 solo admite cuatro ranuras de filamento.');

  const outputSlots = [];
  const oldToNew = {};
  state.outputSlots.forEach((slot, index) => {
    if (used.has(index)) {
      oldToNew[index] = outputSlots.length;
      outputSlots.push({ ...slot });
    }
  });

  const mapping = {};
  for (const [filamentId, slotIndex] of Object.entries(state.mapping)) {
    if (oldToNew[slotIndex] !== undefined) mapping[filamentId] = oldToNew[slotIndex];
  }
  return { outputSlots, mapping, processProfileId: state.processProfileId };
}

async function convertAndSave(automatic = false) {
  if (!state.parsedZip) return;
  const button = $('btn-convert');
  button.disabled = true;
  setLoading('Convirtiendo para Snapmaker U1…', 'Actualizando perfiles, colores y asignaciones sin modificar la geometría.');
  try {
    const { outputSlots, mapping, processProfileId } = conversionConfiguration();
    const blob = await self.MWU1.convert({
      zip: state.parsedZip,
      outputSlots,
      mapping,
      hasSupport: state.analysis.hasSupport,
      processProfileId,
    });
    const data = new Uint8Array(await blob.arrayBuffer());
    setLoading('Verificando el archivo…', 'Comprobando la U1, las cuatro herramientas, los perfiles y la geometría.');
    const verification = await self.MWU1.verifyConversion({
      originalZip: state.parsedZip,
      outputBytes: data,
      outputSlots,
      mapping,
      processProfileId,
    });
    if (!verification.ok) {
      const failed = verification.checks.filter(check => !check.ok).map(check => check.label).join(', ');
      throw new Error(`La conversión no superó la verificación interna: ${failed}. No se guardó ningún archivo.`);
    }
    const result = await window.desktop.saveConverted({
      data,
      suggestedName: state.originalName,
      sourcePath: state.sourcePath,
      automatic: automatic || state.sourceKind === 'watcher',
    });
    if (result.canceled) {
      renderConverter();
      showView('converter-state');
      return;
    }
    state.savedPath = result.path;
    state.verification = verification;
    $('saved-path').textContent = result.path;
    renderVerification(verification);
    $('orca-error').classList.add('hidden');
    showView('success-state');
  } catch (error) {
    showError(error.message || 'No se pudo guardar el archivo convertido.');
  } finally {
    button.disabled = false;
  }
}

function renderVerification(verification) {
  const passed = verification.checks.filter(check => check.ok).length;
  $('verification-summary').textContent = `${passed} de ${verification.checks.length} comprobaciones aprobadas`;
  $('profile-version').textContent = `Perfiles Snapmaker ${verification.profileVersion}`;
  const list = $('verification-list');
  list.replaceChildren();
  for (const check of verification.checks) {
    const item = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'verification-check';
    icon.textContent = '✓';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = check.label;
    const detail = document.createElement('small');
    detail.textContent = check.detail;
    copy.append(title, detail);
    item.append(icon, copy);
    list.appendChild(item);
  }
}

async function openInSnapmakerOrca() {
  if (!state.savedPath) return;
  const button = $('btn-open-orca');
  const originalText = button.textContent;
  const error = $('orca-error');
  error.classList.add('hidden');
  button.disabled = true;
  button.textContent = 'Abriendo…';
  try {
    await window.desktop.openInOrca(state.savedPath);
  } catch (launchError) {
    error.textContent = launchError.message || 'No se pudo abrir Snapmaker Orca.';
    error.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function saveOriginalCopy() {
  if (!state.currentBytes) return;
  try {
    await window.desktop.saveOriginal({
      data: state.currentBytes,
      suggestedName: state.originalName,
      sourcePath: state.sourcePath,
    });
  } catch (error) {
    showError(error.message || 'No se pudo guardar la copia original.');
  }
}

async function chooseFile() {
  try {
    const payload = await window.desktop.chooseFile();
    if (payload) await processPayload({ ...payload, source: 'manual' });
  } catch (error) {
    showError(error.message || 'No se pudo abrir el archivo.');
  }
}

async function handleDroppedFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.3mf')) {
    showError('Solo se admiten archivos con extensión .3mf.');
    return;
  }
  try {
    const filePath = window.desktop.getPathForFile(file);
    if (filePath) {
      const payload = await window.desktop.readFile(filePath);
      await processPayload({ ...payload, source: 'manual' });
    } else {
      await processPayload({
        data: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        path: null,
        source: 'manual',
      });
    }
  } catch (error) {
    showError(error.message || 'No se pudo leer el archivo arrastrado.');
  }
}

function openSettings() {
  const s = state.settings;
  $('setting-watch').checked = Boolean(s.watchEnabled);
  $('setting-folder').textContent = s.watchFolder;
  $('setting-folder').title = s.watchFolder;
  $('setting-startup').checked = Boolean(s.startWithWindows);
  $('setting-tray').checked = Boolean(s.minimizeToTray);
  $('setting-auto').checked = Boolean(s.autoConvertSingleColor);
  $('setting-material').value = s.defaultFilamentType;
  $('settings-error').classList.add('hidden');
  $('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  $('settings-overlay').classList.add('hidden');
}

async function chooseWatchFolder() {
  const folder = await window.desktop.chooseWatchFolder();
  if (folder) {
    $('setting-folder').textContent = folder;
    $('setting-folder').title = folder;
  }
}

async function saveSettings() {
  const warning = $('settings-error');
  warning.classList.add('hidden');
  try {
    state.settings = await window.desktop.updateSettings({
      watchEnabled: $('setting-watch').checked,
      watchFolder: $('setting-folder').textContent,
      startWithWindows: $('setting-startup').checked,
      minimizeToTray: $('setting-tray').checked,
      autoConvertSingleColor: $('setting-auto').checked,
      defaultFilamentType: $('setting-material').value,
    });
    updateWatchStatus();
    closeSettings();
  } catch (error) {
    warning.textContent = error.message || 'No se pudo guardar la configuración.';
    warning.classList.remove('hidden');
  }
}

function wireEvents() {
  $('btn-open').addEventListener('click', event => { event.stopPropagation(); chooseFile(); });
  $('drop-zone').addEventListener('click', event => {
    if (event.target === $('drop-zone') || !event.target.closest('button')) chooseFile();
  });
  $('drop-zone').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') chooseFile();
  });
  $('drop-zone').addEventListener('dragover', event => {
    event.preventDefault();
    $('drop-zone').classList.add('drag-over');
  });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('drag-over'));
  $('drop-zone').addEventListener('drop', event => {
    event.preventDefault();
    $('drop-zone').classList.remove('drag-over');
    handleDroppedFile(event.dataTransfer.files[0]);
  });

  $('btn-convert').addEventListener('click', () => convertAndSave(false));
  $('btn-original').addEventListener('click', saveOriginalCopy);
  $('btn-new').addEventListener('click', resetApp);
  $('btn-error-new').addEventListener('click', resetApp);
  $('btn-adjust').addEventListener('click', () => {
    initializeMapping(state.analysis.filaments);
    renderConverter();
    showView('converter-state');
  });
  $('btn-u1-copy').addEventListener('click', saveOriginalCopy);
  $('btn-u1-new').addEventListener('click', resetApp);
  $('btn-success-new').addEventListener('click', resetApp);
  $('btn-open-orca').addEventListener('click', openInSnapmakerOrca);
  $('btn-show-folder').addEventListener('click', () => {
    if (state.savedPath) window.desktop.showInFolder(state.savedPath);
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', closeSettings);
  $('btn-settings-cancel').addEventListener('click', closeSettings);
  $('btn-folder').addEventListener('click', chooseWatchFolder);
  $('btn-settings-save').addEventListener('click', saveSettings);
  $('settings-overlay').addEventListener('mousedown', event => {
    if (event.target === $('settings-overlay')) closeSettings();
  });

  document.addEventListener('mousedown', event => {
    if (state.colorPopover && !state.colorPopover.contains(event.target) && !event.target.closest('.slot-color')) {
      closeColorPopover();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.colorPopover) closeColorPopover();
      else if (!$('settings-overlay').classList.contains('hidden')) closeSettings();
    }
  });

  window.desktop.onFileOpened(payload => processPayload(payload));
  window.desktop.onFileError(message => showError(message));
  window.desktop.onWatchError(message => {
    const pill = $('watch-status');
    pill.classList.remove('status-on');
    pill.classList.add('status-off');
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    pill.replaceChildren(dot, document.createTextNode(`Error de vigilancia: ${message}`));
    pill.title = message;
  });
}

async function init() {
  wireEvents();
  const info = await window.desktop.getInfo();
  state.settings = info.settings;
  $('version-label').textContent = `${info.appName} v${info.version}`;
  updateWatchStatus();
  showView('drop-state');
}

init().catch(error => showError(error.message));
