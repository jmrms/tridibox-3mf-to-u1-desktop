'use strict';

const fs = require('node:fs');
const path = require('node:path');

function is3mfPath(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.3mf');
}

function isConvertedPath(filePath) {
  return typeof filePath === 'string' && /-u1(?: \(\d+\))?\.3mf$/i.test(filePath);
}

function sanitizeBaseName(name) {
  const cleaned = String(name || 'modelo')
    .replace(/\.3mf$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'modelo';
}

function convertedName(name) {
  return `${sanitizeBaseName(name)}-U1.3mf`;
}

function uniquePath(targetPath, exists = fs.existsSync) {
  if (!exists(targetPath)) return targetPath;
  const parsed = path.parse(targetPath);
  let index = 2;
  let candidate;
  do {
    candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  } while (exists(candidate));
  return candidate;
}

function find3mfArgument(argv) {
  return (argv || []).find(arg => is3mfPath(arg)) || null;
}

function portableExecutablePath(environment = process.env, fallback = process.execPath) {
  const portable = environment?.PORTABLE_EXECUTABLE_FILE;
  return typeof portable === 'string' && path.isAbsolute(portable) ? portable : fallback;
}

function isExecutablePath(filePath) {
  return typeof filePath === 'string'
    && path.isAbsolute(filePath)
    && path.extname(filePath).toLowerCase() === '.exe';
}

function orcaCandidatePaths(environment = process.env, homeDirectory = '') {
  const bases = [
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs'),
    environment.LOCALAPPDATA,
    environment.ProgramW6432,
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    homeDirectory && path.join(homeDirectory, 'AppData', 'Local', 'Programs'),
  ].filter(Boolean);
  const relatives = [
    path.join('Snapmaker Orca', 'Snapmaker Orca.exe'),
    path.join('Snapmaker Orca', 'Snapmaker_Orca.exe'),
    path.join('Snapmaker Orca', 'snapmaker-orca.exe'),
    path.join('Snapmaker_Orca', 'Snapmaker Orca.exe'),
    path.join('Snapmaker_Orca', 'Snapmaker_Orca.exe'),
    path.join('Snapmaker', 'Snapmaker Orca', 'Snapmaker Orca.exe'),
  ];
  return [...new Set(bases.flatMap(base => relatives.map(relative => path.join(base, relative))))];
}

module.exports = {
  convertedName,
  find3mfArgument,
  is3mfPath,
  isConvertedPath,
  isExecutablePath,
  orcaCandidatePaths,
  portableExecutablePath,
  sanitizeBaseName,
  uniquePath,
};
