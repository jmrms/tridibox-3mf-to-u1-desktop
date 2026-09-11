self.MWU1 = self.MWU1 || {};

function filamentProfileFor(type) {
  const profiles = self.MWU1.FILAMENT_PROFILES || [];
  return profiles.find(profile => profile.type === type) || profiles[0] || null;
}

self.MWU1.getFilamentProfile = filamentProfileFor;

function processProfileFor(id) {
  const profiles = self.MWU1.U1_PROCESS_PROFILES || [];
  return profiles.find(profile => profile.id === id)
    || profiles.find(profile => profile.id === 'standard')
    || null;
}

self.MWU1.getProcessProfile = processProfileFor;

/** Serialize XML doc, ensuring exactly one XML declaration. */
function serializeXML(doc) {
  let xml = new XMLSerializer().serializeToString(doc);
  // Strip any existing declaration that XMLSerializer preserved from the parsed input
  xml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
}

/**
 * Convert a Bambu Lab .3mf to Snapmaker U1 format.
 * Port of the /convert route from app.py:280-402.
 *
 * @param {Object} params
 * @param {JSZip} params.zip - Pre-parsed JSZip instance (from analyze)
 * @param {Array<{color: string, type: string}>} params.outputSlots - User-configured output slots
 * @param {Object<string, number>} params.mapping - Input filament ID → output slot index
 * @param {boolean} params.hasSupport - Whether the original file uses supports
 * @param {string} params.processProfileId - quality, standard or fast
 * @returns {Promise<Blob>} The converted .3mf file
 */
self.MWU1.convert = async function({ zip, outputSlots, mapping, hasSupport, processProfileId = 'standard' }) {
  const { MIN_FILAMENTS, DUMMY_SLOT_COLOR, DUMMY_SLOT_TYPE } = self.MWU1;

  // Build id_mapping: input filament ID → new 1-based ID string
  const idMapping = {};
  for (const [fid, slotIdx] of Object.entries(mapping)) {
    idMapping[fid] = String(slotIdx + 1);
  }

  // Run XML transformations in parallel (independent file reads)
  const [newSliceInfo, newModelSettings] = await Promise.all([
    modifySliceInfo(zip, outputSlots, mapping, MIN_FILAMENTS, DUMMY_SLOT_COLOR, DUMMY_SLOT_TYPE),
    modifyModelSettings(zip, idMapping),
  ]);
  const newProjectSettings = buildProjectSettings(outputSlots, hasSupport, processProfileId);

  // Build output ZIP — copy entries in parallel, substitute modified files
  // Only include substitutions for files that existed and were successfully modified
  const substitutions = {};
  if (newSliceInfo !== null) substitutions['Metadata/slice_info.config'] = newSliceInfo;
  if (newModelSettings !== null) substitutions['Metadata/model_settings.config'] = newModelSettings;
  substitutions['Metadata/project_settings.config'] = newProjectSettings;

  const entries = Object.entries(zip.files).filter(([path, file]) => {
    if (file.dir) return false;
    const safe = path.replace(/\\/g, '/');
    return !safe.startsWith('..') && !safe.startsWith('/');
  });

  // Process entries sequentially to avoid holding all decompressed buffers in memory at once
  const output = new JSZip();
  const writtenPaths = new Set();
  for (const [path, file] of entries) {
    if (path in substitutions) {
      output.file(path, substitutions[path]);
    } else {
      output.file(path, await file.async('uint8array'));
    }
    writtenPaths.add(path);
  }

  // Standard 3MF files may not contain project settings yet. In that case the
  // newly generated U1 settings must be added instead of merely substituted.
  for (const [path, content] of Object.entries(substitutions)) {
    if (!writtenPaths.has(path)) output.file(path, content);
  }

  return output.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/octet-stream' });
};

/**
 * Modify slice_info.config XML.
 * Port of app.py:284-337.
 */
async function modifySliceInfo(zip, outputSlots, mapping, MIN_FILAMENTS, DUMMY_COLOR, DUMMY_TYPE) {
  const sliceFile = zip.file('Metadata/slice_info.config');
  if (!sliceFile) return null; // file doesn't exist — caller will skip substitution
  let xmlStr = await sliceFile.async('string');

  // Replace printer model ID (raw string, before parsing)
  xmlStr = xmlStr.replace(
    /key="printer_model_id" value="[^"]*"/,
    'key="printer_model_id" value="Snapmaker U1"'
  );

  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
  let printerItem = doc.querySelector('header_item[key="printer_model_id"]');
  if (!printerItem) {
    const header = doc.querySelector('header') || doc.documentElement;
    printerItem = doc.createElement('header_item');
    printerItem.setAttribute('key', 'printer_model_id');
    header.appendChild(printerItem);
  }
  printerItem.setAttribute('value', 'Snapmaker U1');
  const parent = doc.querySelector('plate') || doc.documentElement;

  // Get direct <filament> children only (not descendants)
  const existingNodes = Array.from(parent.children).filter(n => n.tagName === 'filament');

  const seenSlots = new Set();
  for (const node of existingNodes) {
    const oldId = node.getAttribute('id');
    if (!(oldId in mapping)) {
      parent.removeChild(node);
      continue;
    }
    const slotIdx = mapping[oldId];
    if (seenSlots.has(slotIdx)) {
      parent.removeChild(node); // duplicate
      continue;
    }
    seenSlots.add(slotIdx);
    const slot = outputSlots[slotIdx];
    node.setAttribute('id', String(slotIdx + 1));
    node.setAttribute('color', slot.color);
    node.setAttribute('type', filamentProfileFor(slot.type)?.project_type || slot.type);
  }

  // Add nodes for output slots without corresponding input
  for (let i = 0; i < outputSlots.length; i++) {
    if (seenSlots.has(i)) continue;
    const el = doc.createElement('filament');
    el.setAttribute('id', String(i + 1));
    el.setAttribute('type', filamentProfileFor(outputSlots[i].type)?.project_type || outputSlots[i].type);
    el.setAttribute('color', outputSlots[i].color);
    el.setAttribute('used_m', '0');
    el.setAttribute('used_g', '0');
    parent.appendChild(el);
  }

  // Pad to MIN_FILAMENTS with dummy entries
  let counter = outputSlots.length + 1;
  while (counter <= MIN_FILAMENTS) {
    const dummy = doc.createElement('filament');
    dummy.setAttribute('id', String(counter));
    dummy.setAttribute('type', DUMMY_TYPE);
    dummy.setAttribute('color', DUMMY_COLOR);
    dummy.setAttribute('used_m', '0');
    dummy.setAttribute('used_g', '0');
    parent.appendChild(dummy);
    counter++;
  }

  return serializeXML(doc);
}

/**
 * Modify model_settings.config XML.
 * Port of app.py:339-350.
 */
async function modifyModelSettings(zip, idMapping) {
  const modelFile = zip.file('Metadata/model_settings.config');
  if (!modelFile) return null;
  const xmlStr = await modelFile.async('string');
  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');

  for (const meta of doc.querySelectorAll('metadata[key="extruder"]')) {
    const oldVal = meta.getAttribute('value');
    if (oldVal in idMapping) {
      meta.setAttribute('value', idMapping[oldVal]);
    }
  }

  return serializeXML(doc);
}

/**
 * Build new project_settings.config JSON.
 * Port of app.py:352-386.
 */
function buildProjectSettings(outputSlots, hasSupport, processProfileId) {
  const { MIN_FILAMENTS, DEFAULT_FILAMENT_PROFILE, DUMMY_SLOT_COLOR, DUMMY_SLOT_TYPE,
          BASE_TEMPLATE, SUPPORT_DELTA, FILAMENT_PROFILES, U1_MACHINE_PROFILE,
          U1_PROCESS_PROFILE, U1_MACHINE_NAME, U1_PROCESS_NAME, toRGBA } = self.MWU1;
  const selectedProcess = processProfileFor(processProfileId) || {
    id: 'standard',
    settings_id: U1_PROCESS_NAME,
    settings: U1_PROCESS_PROFILE || {},
  };

  // Deep clone base template
  const combined = JSON.parse(JSON.stringify(BASE_TEMPLATE));

  // Refresh the machine and 0.20 mm process data with the bundled official
  // Snapmaker Orca profile snapshot. The template remains as a compatibility
  // base for project-only settings that are not present in system profiles.
  Object.assign(combined, JSON.parse(JSON.stringify(U1_MACHINE_PROFILE || {})));
  Object.assign(combined, JSON.parse(JSON.stringify(selectedProcess.settings || {})));
  combined.printer_model = 'Snapmaker U1';
  combined.printer_settings_id = U1_MACHINE_NAME || 'Snapmaker U1 (0.4 nozzle)';
  combined.printer_variant = '0.4';
  combined.print_settings_id = selectedProcess.settings_id
    || U1_PROCESS_NAME
    || '0.20mm Standard @Snapmaker U1 (0.4 nozzle)';
  combined.default_print_profile = combined.print_settings_id;
  combined.print_compatible_printers = [combined.printer_settings_id];

  // Apply support delta if needed
  if (hasSupport) {
    Object.assign(combined, JSON.parse(JSON.stringify(SUPPORT_DELTA)));
  }

  const slots = outputSlots.map(slot => ({ ...slot }));
  while (slots.length < MIN_FILAMENTS) {
    slots.push({ color: DUMMY_SLOT_COLOR, type: DUMMY_SLOT_TYPE });
  }

  const numFilaments = slots.length;
  const defaultProfile = FILAMENT_PROFILES[0] || {
    type: DUMMY_SLOT_TYPE,
    project_type: DUMMY_SLOT_TYPE,
    settings_id: DEFAULT_FILAMENT_PROFILE,
    filament_id: '',
    settings: {},
  };
  const selectedProfiles = slots.map(slot => filamentProfileFor(slot.type) || defaultProfile);

  // Apply every filament setting from the resolved official profiles per slot.
  // This includes temperatures, bed values, cooling, flow, pressure advance,
  // retraction and tool-change behavior instead of changing only the preset name.
  const protectedKeys = new Set(['filament_colour', 'filament_type', 'filament_settings_id']);
  const materialKeys = new Set(selectedProfiles.flatMap(profile => Object.keys(profile.settings || {})));
  for (const key of materialKeys) {
    if (protectedKeys.has(key)) continue;
    const previous = Array.isArray(combined[key]) ? combined[key] : [];
    combined[key] = selectedProfiles.map((profile, index) => {
      const value = profile.settings?.[key];
      if (value !== undefined) return value;
      return previous[index] ?? previous[0] ?? '';
    });
  }

  combined.filament_colour = slots.map(slot => toRGBA(slot.color));
  combined.filament_type = selectedProfiles.map(profile => profile.project_type || profile.type);
  combined.filament_settings_id = selectedProfiles.map(profile => profile.settings_id || DEFAULT_FILAMENT_PROFILE);
  combined.filament_ids = selectedProfiles.map(profile => profile.filament_id || '');

  // Normalize ALL filament_* arrays to match filament count
  for (const [key, val] of Object.entries(combined)) {
    if (key.startsWith('filament_') && Array.isArray(val) && val.length > 0 && val.length !== numFilaments) {
      if (val.length < numFilaments) {
        while (val.length < numFilaments) val.push(val[val.length - 1]);
      } else {
        combined[key] = val.slice(0, numFilaments);
      }
    }
  }

  return JSON.stringify(combined, null, 4);
}
