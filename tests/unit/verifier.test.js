import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { build3mfZip, buildBambuSliceInfoZip } from '../helpers/zip-builder.js';

const { analyze, convert, verifyConversion } = globalThis.MWU1;

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

const slots = [
  { color: '#FF0000', type: 'PLA' },
  { color: '#00FF00', type: 'PETG-HF' },
  { color: '#0000FF', type: 'ABS' },
  { color: '#FFFF00', type: 'TPU' },
];
const mapping = { '1': 0, '2': 1, '3': 2, '4': 3 };

async function conversion(processProfileId = 'standard') {
  const source = await buildBambuSliceInfoZip([
    { id: '1', color: '#FF0000', type: 'PLA' },
    { id: '2', color: '#00FF00', type: 'PETG' },
    { id: '3', color: '#0000FF', type: 'ABS' },
    { id: '4', color: '#FFFF00', type: 'TPU' },
  ]);
  const sourceZip = await JSZip.loadAsync(source);
  sourceZip.file('3D/Textures/paint.bin', new Uint8Array([1, 4, 9, 16, 25]));
  const sourceWithPaint = await sourceZip.generateAsync({ type: 'arraybuffer' });
  const analysis = await analyze(sourceWithPaint);
  const blob = await convert({
    zip: analysis.zip,
    outputSlots: slots,
    mapping,
    hasSupport: analysis.hasSupport,
    processProfileId,
  });
  return { analysis, bytes: await blobToArrayBuffer(blob) };
}

describe('post-conversion verifier', () => {
  it('accepts a valid U1 archive and verifies every protected payload byte', async () => {
    const { analysis, bytes } = await conversion();
    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: bytes,
      outputSlots: slots,
      mapping,
    });

    expect(result.ok).toBe(true);
    expect(result.checks.every(check => check.ok)).toBe(true);
    expect(result.checks.find(check => check.id === 'materials').detail).toMatch(/parámetros oficiales/);
    expect(result.checks.find(check => check.id === 'unchanged_payload').detail).toMatch(/byte por byte/);
  });

  it('verifies the selected fast 0.28 mm profile instead of the standard profile', async () => {
    const { analysis, bytes } = await conversion('fast');
    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: bytes,
      outputSlots: slots,
      mapping,
      processProfileId: 'fast',
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find(check => check.id === 'u1_target').detail).toContain('Calidad rápida · 0,28 mm');
  });

  it('accepts and identifies the optimized 0.16 mm quality profile', async () => {
    const { analysis, bytes } = await conversion('quality');
    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: bytes,
      outputSlots: slots,
      mapping,
      processProfileId: 'quality',
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find(check => check.id === 'u1_target').detail)
      .toContain('Muy buena calidad · 0,16 mm');
  });

  it('rejects an archive whose target printer was altered', async () => {
    const { analysis, bytes } = await conversion();
    const zip = await JSZip.loadAsync(bytes);
    const settings = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    settings.printer_model = 'Otra impresora';
    zip.file('Metadata/project_settings.config', JSON.stringify(settings));
    const tampered = await zip.generateAsync({ type: 'uint8array' });

    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: tampered,
      outputSlots: slots,
      mapping,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find(check => check.id === 'u1_target').ok).toBe(false);
  });

  it('rejects any change to the model or painting payload', async () => {
    const { analysis, bytes } = await conversion();
    const zip = await JSZip.loadAsync(bytes);
    zip.file('3D/Textures/paint.bin', new Uint8Array([99]));
    const tampered = await zip.generateAsync({ type: 'uint8array' });

    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: tampered,
      outputSlots: slots,
      mapping,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find(check => check.id === 'unchanged_payload').ok).toBe(false);
  });

  it('converts and verifies a standard 3MF that has no slicer metadata', async () => {
    const source = await build3mfZip([{ name: 'PLA', color: '#336699' }]);
    const analysis = await analyze(source);
    const outputSlots = [{ color: '#336699', type: 'PLA' }];
    const standardMapping = { [analysis.filaments[0].id]: 0 };
    const blob = await convert({
      zip: analysis.zip,
      outputSlots,
      mapping: standardMapping,
      hasSupport: false,
    });
    const bytes = await blobToArrayBuffer(blob);
    const result = await verifyConversion({
      originalZip: analysis.zip,
      outputBytes: bytes,
      outputSlots,
      mapping: standardMapping,
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find(check => check.id === 'materials').ok).toBe(true);
    expect(result.checks.find(check => check.id === 'slice_info').ok).toBe(true);
  });
});
