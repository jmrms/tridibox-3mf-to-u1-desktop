self.MWU1 = self.MWU1 || {};

const MWU1_REPLACED_FILES = new Set([
  'Metadata/slice_info.config',
  'Metadata/model_settings.config',
  'Metadata/project_settings.config',
]);

function verificationCheck(checks, id, label, ok, detail) {
  checks.push({ id, label, ok: Boolean(ok), detail: String(detail || '') });
}

function isSafeArchivePath(filePath, file) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const original = String(file?.unsafeOriginalName || normalized).replace(/\\/g, '/');
  const isSafe = value => value && !value.startsWith('/') && !value.split('/').includes('..');
  return isSafe(normalized) && isSafe(original);
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value?.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
  }
  return new Uint8Array(value);
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function parseVerifiedXml(xml) {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  if (document.querySelector('parsererror')) throw new Error('XML no válido');
  return document;
}

function expectedPhysicalSlots(outputSlots) {
  const slots = outputSlots.map(slot => ({ ...slot }));
  while (slots.length < self.MWU1.MIN_FILAMENTS) {
    slots.push({
      color: self.MWU1.DUMMY_SLOT_COLOR,
      type: self.MWU1.DUMMY_SLOT_TYPE,
    });
  }
  return slots;
}

/**
 * Verify a converted 3MF before it is written to disk.
 * Every hard check must pass for the renderer to display a successful result.
 */
self.MWU1.verifyConversion = async function({
  originalZip,
  outputBytes,
  outputSlots,
  mapping,
  processProfileId = 'standard',
}) {
  const checks = [];
  const expectedProcess = (self.MWU1.U1_PROCESS_PROFILES || [])
    .find(profile => profile.id === processProfileId);
  let outputZip;

  try {
    outputZip = await JSZip.loadAsync(exactBytes(outputBytes));
    verificationCheck(checks, 'archive', 'Archivo 3MF válido', true, 'El contenedor ZIP se abrió correctamente.');
  } catch (error) {
    verificationCheck(checks, 'archive', 'Archivo 3MF válido', false, error.message);
    return {
      ok: false,
      profileVersion: self.MWU1.U1_PROFILE_VERSION,
      processProfileId,
      checks,
      materials: outputSlots.map(slot => slot.type),
    };
  }

  const unsafePaths = Object.entries(outputZip.files)
    .filter(([filePath, file]) => !file.dir && !isSafeArchivePath(filePath, file))
    .map(([filePath]) => filePath);
  verificationCheck(
    checks,
    'safe_paths',
    'Rutas internas seguras',
    unsafePaths.length === 0,
    unsafePaths.length ? unsafePaths.join(', ') : 'No hay rutas absolutas ni recorridos fuera del archivo.'
  );

  const validSlotCount = outputSlots.length >= 1 && outputSlots.length <= self.MWU1.PHYSICAL_SLOTS;
  const validMapping = Object.values(mapping || {}).every(index => Number.isInteger(index)
    && index >= 0 && index < outputSlots.length);
  verificationCheck(
    checks,
    'tools',
    'Asignación de 1 a 4 herramientas',
    validSlotCount && validMapping,
    `${outputSlots.length} ranura(s) configurada(s).`
  );

  let projectSettings = null;
  const projectFile = outputZip.file('Metadata/project_settings.config');
  try {
    if (!projectFile) throw new Error('Falta Metadata/project_settings.config');
    projectSettings = JSON.parse(await projectFile.async('string'));
    verificationCheck(checks, 'project_json', 'Metadatos del proyecto', true, 'JSON válido y legible.');
  } catch (error) {
    verificationCheck(checks, 'project_json', 'Metadatos del proyecto', false, error.message);
  }

  if (projectSettings) {
    const correctTarget = projectSettings.printer_model === 'Snapmaker U1'
      && projectSettings.printer_settings_id === self.MWU1.U1_MACHINE_NAME
      && expectedProcess
      && projectSettings.print_settings_id === expectedProcess.settings_id;
    verificationCheck(
      checks,
      'u1_target',
      'Destino Snapmaker U1',
      correctTarget,
      correctTarget
        ? `${expectedProcess.label} · ${expectedProcess.layer_height} · boquilla 0,4 mm`
        : 'El identificador de impresora o proceso no coincide con el perfil incluido.'
    );

    const physicalSlots = expectedPhysicalSlots(outputSlots);
    const fallback = self.MWU1.FILAMENT_PROFILES[0];
    const profiles = physicalSlots.map(slot => self.MWU1.getFilamentProfile(slot.type) || fallback);
    const metadataOk = equalValue(
      projectSettings.filament_colour,
      physicalSlots.map(slot => self.MWU1.toRGBA(slot.color))
    ) && equalValue(
      projectSettings.filament_type,
      profiles.map(profile => profile.project_type || profile.type)
    ) && equalValue(
      projectSettings.filament_settings_id,
      profiles.map(profile => profile.settings_id)
    ) && equalValue(
      projectSettings.filament_ids,
      profiles.map(profile => profile.filament_id || '')
    );

    let settingsOk = metadataOk;
    let verifiedSettings = 0;
    const ignored = new Set(['filament_colour', 'filament_type', 'filament_settings_id']);
    const keys = new Set(profiles.flatMap(profile => Object.keys(profile.settings || {})));
    for (const key of keys) {
      if (ignored.has(key)) continue;
      const actual = projectSettings[key];
      if (!Array.isArray(actual) || actual.length !== physicalSlots.length) {
        settingsOk = false;
        continue;
      }
      profiles.forEach((profile, index) => {
        const expected = profile.settings?.[key];
        if (expected !== undefined && !equalValue(actual[index], expected)) settingsOk = false;
      });
      verifiedSettings += 1;
    }
    verificationCheck(
      checks,
      'materials',
      'Colores y perfiles de material',
      settingsOk,
      settingsOk
        ? `${verifiedSettings} parámetros oficiales verificados en cada ranura.`
        : 'Uno o más colores, identificadores o parámetros de material no coinciden.'
    );
  } else {
    verificationCheck(checks, 'u1_target', 'Destino Snapmaker U1', false, 'No se pudo leer la configuración.');
    verificationCheck(checks, 'materials', 'Colores y perfiles de material', false, 'No se pudo leer la configuración.');
  }

  const sliceFile = outputZip.file('Metadata/slice_info.config');
  if (sliceFile) {
    try {
      const sliceDocument = parseVerifiedXml(await sliceFile.async('string'));
      const printer = sliceDocument.querySelector('header_item[key="printer_model_id"]')?.getAttribute('value');
      const filaments = [...sliceDocument.querySelectorAll('plate > filament')];
      const expectedSlots = expectedPhysicalSlots(outputSlots);
      const sliceOk = printer === 'Snapmaker U1'
        && filaments.length === self.MWU1.MIN_FILAMENTS
        && expectedSlots.every((slot, index) => {
          const node = filaments.find(item => item.getAttribute('id') === String(index + 1));
          const profile = self.MWU1.getFilamentProfile(slot.type);
          return node
            && node.getAttribute('color') === slot.color
            && node.getAttribute('type') === (profile?.project_type || slot.type);
        });
      verificationCheck(
        checks,
        'slice_info',
        'Asignaciones del laminador',
        sliceOk,
        sliceOk ? 'Las cuatro posiciones y el modelo U1 están identificados.' : 'La asignación XML no coincide.'
      );
    } catch (error) {
      verificationCheck(checks, 'slice_info', 'Asignaciones del laminador', false, error.message);
    }
  } else {
    verificationCheck(checks, 'slice_info', 'Asignaciones del laminador', true, 'El archivo original no incluía estos metadatos opcionales.');
  }

  const modelFile = outputZip.file('Metadata/model_settings.config');
  if (modelFile) {
    try {
      const modelDocument = parseVerifiedXml(await modelFile.async('string'));
      const extruders = [...modelDocument.querySelectorAll('metadata[key="extruder"]')]
        .map(node => Number(node.getAttribute('value')));
      const extrudersOk = extruders.every(value => Number.isInteger(value)
        && value >= 1 && value <= self.MWU1.PHYSICAL_SLOTS);
      verificationCheck(
        checks,
        'model_tools',
        'Herramientas del modelo',
        extrudersOk,
        extrudersOk ? `${extruders.length} asignación(es) dentro del rango 1–4.` : 'Hay una herramienta fuera del rango 1–4.'
      );
    } catch (error) {
      verificationCheck(checks, 'model_tools', 'Herramientas del modelo', false, error.message);
    }
  } else {
    verificationCheck(checks, 'model_tools', 'Herramientas del modelo', true, 'El archivo original no incluía estos metadatos opcionales.');
  }

  let unchangedOk = true;
  let unchangedCount = 0;
  if (!originalZip?.files) {
    unchangedOk = false;
  } else {
    for (const [filePath, originalFile] of Object.entries(originalZip.files)) {
      if (originalFile.dir || MWU1_REPLACED_FILES.has(filePath) || !isSafeArchivePath(filePath, originalFile)) continue;
      const convertedFile = outputZip.file(filePath);
      if (!convertedFile) {
        unchangedOk = false;
        continue;
      }
      const [before, after] = await Promise.all([
        originalFile.async('uint8array'),
        convertedFile.async('uint8array'),
      ]);
      if (!bytesEqual(before, after)) unchangedOk = false;
      unchangedCount += 1;
    }
  }
  verificationCheck(
    checks,
    'unchanged_payload',
    'Geometría y pintura sin cambios',
    unchangedOk,
    unchangedOk
      ? `${unchangedCount} archivo(s) interno(s) comparados byte por byte.`
      : 'Al menos un archivo que debía conservarse fue modificado o eliminado.'
  );

  return {
    ok: checks.every(check => check.ok),
    profileVersion: self.MWU1.U1_PROFILE_VERSION,
    processProfileId,
    checks,
    materials: outputSlots.map(slot => slot.type),
  };
};
