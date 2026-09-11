'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROFILE_ROOT = path.resolve(process.argv[2] || '');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'src', 'lib', 'filament-profiles.js');

if (!process.argv[2] || !fs.existsSync(path.join(PROFILE_ROOT, '..', 'Snapmaker.json'))) {
  throw new Error('Uso: node scripts/generate-u1-profiles.js <resources/profiles/Snapmaker>');
}

function listJsonFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  });
}

const profilesByName = new Map();
for (const filePath of listJsonFiles(PROFILE_ROOT)) {
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (profile.name) profilesByName.set(profile.name, profile);
}

function resolveProfile(name, stack = []) {
  if (stack.includes(name)) throw new Error(`Herencia circular: ${[...stack, name].join(' -> ')}`);
  const profile = profilesByName.get(name);
  if (!profile) throw new Error(`No se encontró el perfil heredado: ${name}`);
  const inherited = profile.inherits ? resolveProfile(profile.inherits, [...stack, name]) : {};
  return { ...inherited, ...profile };
}

const metadataKeys = new Set([
  'type', 'name', 'from', 'instantiation', 'inherits', 'setting_id', 'description',
  'renamed_from', 'compatible_printers', 'compatible_prints',
  'compatible_printers_condition', 'compatible_prints_condition', 'version',
]);

function runtimeSettings(profile) {
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !metadataKeys.has(key)));
}

function filamentDefinition(type, sourceName) {
  const profile = resolveProfile(sourceName);
  const settings = {};
  for (const [key, value] of Object.entries(profile)) {
    if (metadataKeys.has(key) || !Array.isArray(value) || value.length === 0) continue;
    settings[key] = value[0];
  }
  return {
    type,
    project_type: settings.filament_type || type,
    settings_id: sourceName,
    filament_id: profile.filament_id || '',
    settings,
  };
}

const manifest = JSON.parse(fs.readFileSync(path.join(PROFILE_ROOT, '..', 'Snapmaker.json'), 'utf8'));
let sourceCommit = 'desconocido';
try {
  sourceCommit = execFileSync('git', ['-C', PROFILE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // The generated profile remains valid when the source was downloaded without Git metadata.
}

const machineName = 'Snapmaker U1 (0.4 nozzle)';
const processName = '0.20mm Standard @Snapmaker U1 (0.4 nozzle)';
const highQualityName = '0.20mm High Quality @Snapmaker U1 (0.4 nozzle)';
const qualityTuningKeys = [
  'default_acceleration',
  'outer_wall_acceleration',
  'outer_wall_speed',
  'inner_wall_speed',
  'sparse_infill_speed',
  'top_surface_speed',
];
const processDefinitions = [
  {
    id: 'quality',
    label: 'Muy buena calidad',
    layer_height: '0,16 mm',
    description: 'Paredes visibles más lentas y aceleración reducida para un acabado superior.',
    settings_id: '0.16mm Standard @Snapmaker U1 (0.4 nozzle)',
    tuning_source: highQualityName,
  },
  {
    id: 'standard',
    label: 'Calidad estándar',
    layer_height: '0,20 mm',
    description: 'Equilibrio recomendado entre calidad y velocidad.',
    settings_id: processName,
  },
  {
    id: 'fast',
    label: 'Calidad rápida',
    layer_height: '0,28 mm',
    description: 'Máxima altura oficial para la boquilla de 0,4 mm.',
    settings_id: '0.28mm Standard @Snapmaker U1 (0.4 nozzle)',
  },
];
const generatedProcesses = processDefinitions.map(process => {
  const settings = runtimeSettings(resolveProfile(process.settings_id));
  if (process.tuning_source) {
    const tuning = runtimeSettings(resolveProfile(process.tuning_source));
    for (const key of qualityTuningKeys) {
      if (!(key in tuning)) throw new Error(`Falta ${key} en ${process.tuning_source}`);
      settings[key] = tuning[key];
    }
  }
  return { ...process, settings };
});
const definitions = [
  filamentDefinition('PLA', 'Snapmaker PLA SnapSpeed @U1'),
  filamentDefinition('PETG-HF', 'Snapmaker PETG HF'),
  filamentDefinition('ABS', 'Generic ABS'),
  filamentDefinition('TPU', 'Generic TPU'),
];

const generated = `// Generated from the official Snapmaker Orca profiles. Do not edit manually.\n` +
  `// Profile bundle ${manifest.version}; source commit ${sourceCommit}.\n` +
  `self.MWU1 = self.MWU1 || {};\n\n` +
  `self.MWU1.U1_PROFILE_VERSION = ${JSON.stringify(manifest.version)};\n` +
  `self.MWU1.U1_PROFILE_SOURCE_COMMIT = ${JSON.stringify(sourceCommit)};\n` +
  `self.MWU1.U1_MACHINE_NAME = ${JSON.stringify(machineName)};\n` +
  `self.MWU1.U1_PROCESS_NAME = ${JSON.stringify(processName)};\n` +
  `self.MWU1.U1_MACHINE_PROFILE = ${JSON.stringify(runtimeSettings(resolveProfile(machineName)), null, 2)};\n\n` +
  `self.MWU1.U1_PROCESS_PROFILE = ${JSON.stringify(runtimeSettings(resolveProfile(processName)), null, 2)};\n\n` +
  `self.MWU1.U1_PROCESS_PROFILES = ${JSON.stringify(generatedProcesses, null, 2)};\n\n` +
  `self.MWU1.FILAMENT_PROFILES = ${JSON.stringify(definitions, null, 2)};\n`;

fs.writeFileSync(OUTPUT_FILE, generated, 'utf8');
process.stdout.write(`${OUTPUT_FILE}\n`);
