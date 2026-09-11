import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  convertedName,
  find3mfArgument,
  is3mfPath,
  isConvertedPath,
  isExecutablePath,
  orcaCandidatePaths,
  portableExecutablePath,
  sanitizeBaseName,
  uniquePath,
} = require('../../main-utils.js');

describe('desktop file helpers', () => {
  it('recognizes 3MF paths without accepting other extensions', () => {
    expect(is3mfPath('modelo.3mf')).toBe(true);
    expect(is3mfPath('MODELO.3MF')).toBe(true);
    expect(is3mfPath('modelo.3mf.exe')).toBe(false);
  });

  it('sanitizes Windows-reserved filename characters', () => {
    expect(sanitizeBaseName('pieza:roja?.3mf')).toBe('pieza_roja_');
  });

  it('builds the U1 output filename', () => {
    expect(convertedName('robot.3mf')).toBe('robot-U1.3mf');
  });

  it('detects generated outputs to prevent watcher loops', () => {
    expect(isConvertedPath('robot-U1.3mf')).toBe(true);
    expect(isConvertedPath('robot-U1 (2).3mf')).toBe(true);
    expect(isConvertedPath('robot.3mf')).toBe(false);
  });

  it('finds a file passed through the Windows command line', () => {
    expect(find3mfArgument(['app.exe', '--hidden', 'C:\\Models\\pieza.3mf']))
      .toBe('C:\\Models\\pieza.3mf');
  });

  it('chooses a collision-free output path', () => {
    const existing = new Set(['/tmp/model-U1.3mf', '/tmp/model-U1 (2).3mf']);
    expect(uniquePath('/tmp/model-U1.3mf', value => existing.has(value)))
      .toBe('/tmp/model-U1 (3).3mf');
  });

  it('uses the original portable EXE for Windows startup registration', () => {
    expect(portableExecutablePath(
      { PORTABLE_EXECUTABLE_FILE: '/portable/Tridibox.exe' },
      '/temporary/electron.exe'
    )).toBe('/portable/Tridibox.exe');
    expect(portableExecutablePath({}, '/temporary/electron.exe')).toBe('/temporary/electron.exe');
  });

  it('builds common Snapmaker Orca installation candidates', () => {
    const candidates = orcaCandidatePaths({ LOCALAPPDATA: '/local' }, '/users/demo');
    expect(candidates).toContain(path.join('/local', 'Programs', 'Snapmaker Orca', 'Snapmaker Orca.exe'));
    expect(candidates).toContain(path.join('/users/demo', 'AppData', 'Local', 'Programs', 'Snapmaker Orca', 'Snapmaker Orca.exe'));
    expect(isExecutablePath('/apps/Snapmaker Orca.exe')).toBe(true);
    expect(isExecutablePath('/apps/Snapmaker Orca.txt')).toBe(false);
  });
});
