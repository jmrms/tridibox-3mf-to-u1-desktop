import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildBambuSliceInfoZip,
  buildBambuSettingsZip,
  buildTraversalZip,
} from '../helpers/zip-builder.js';

const { analyze, convert } = globalThis.MWU1;

/** Convert Blob to ArrayBuffer (jsdom's Blob lacks .arrayBuffer()). */
function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

async function convertFixture(buf, outputSlots, mapping, hasSupport = false, processProfileId = 'standard') {
  const analysis = await analyze(buf);
  const blob = await convert({
    zip: analysis.zip,
    outputSlots,
    mapping,
    hasSupport: hasSupport || analysis.hasSupport,
    processProfileId,
  });
  const outputBuf = await blobToArrayBuffer(blob);
  const outputZip = await JSZip.loadAsync(outputBuf);
  return outputZip;
}

describe('converter', () => {
  it('exposes exactly the three requested 0.4 mm quality choices', () => {
    expect(globalThis.MWU1.U1_PROCESS_PROFILES.map(profile => [
      profile.id,
      profile.layer_height,
      profile.settings_id,
    ])).toEqual([
      ['quality', '0,16 mm', '0.16mm Standard @Snapmaker U1 (0.4 nozzle)'],
      ['standard', '0,20 mm', '0.20mm Standard @Snapmaker U1 (0.4 nozzle)'],
      ['fast', '0,28 mm', '0.28mm Standard @Snapmaker U1 (0.4 nozzle)'],
    ]);
  });

  it('combines the official 0.16 mm shell setup with the official high-quality motion tuning', () => {
    const quality = globalThis.MWU1.U1_PROCESS_PROFILES.find(profile => profile.id === 'quality');
    expect(quality.tuning_source).toBe('0.20mm High Quality @Snapmaker U1 (0.4 nozzle)');
    expect(quality.settings).toMatchObject({
      layer_height: '0.16',
      top_shell_layers: '6',
      bottom_shell_layers: '4',
      sparse_infill_pattern: 'gyroid',
      default_acceleration: ['4000', '4000'],
      outer_wall_acceleration: ['2000', '2000'],
      outer_wall_speed: ['60', '60'],
      inner_wall_speed: ['150', '150'],
      sparse_infill_speed: ['200', '200'],
      top_surface_speed: ['150', '150'],
    });
  });

  it('keeps the standard profile fast internally without exceeding the official U1 values', () => {
    const standard = globalThis.MWU1.U1_PROCESS_PROFILES.find(profile => profile.id === 'standard');
    expect(standard.settings).toMatchObject({
      layer_height: '0.2',
      top_shell_layers: '5',
      bottom_shell_layers: '3',
      default_acceleration: '10000',
      outer_wall_speed: ['200', '500'],
      inner_wall_speed: ['300', '600'],
      sparse_infill_speed: ['270', '600'],
      travel_speed: '500',
    });
  });

  describe('slice_info.config transformation', () => {
    it('replaces printer_model_id with Snapmaker U1', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 }
      );

      const xml = await output.file('Metadata/slice_info.config').async('string');
      expect(xml).toContain('Snapmaker U1');
      expect(xml).not.toContain('Bambu Lab');
    });

    it('remaps filament colors and types', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
        { id: '2', color: '#00FF00', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#0000FF', type: 'ABS' }, { color: '#FFFF00', type: 'TPU' }],
        { '1': 0, '2': 1 }
      );

      const xml = await output.file('Metadata/slice_info.config').async('string');
      expect(xml).toContain('#0000FF');
      expect(xml).toContain('ABS');
      expect(xml).toContain('#FFFF00');
      expect(xml).toContain('TPU');
    });
  });

  describe('model_settings.config transformation', () => {
    it('remaps extruder values', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
        { id: '2', color: '#00FF00', type: 'PLA' },
      ]);
      // Map filament 1 → slot 1, filament 2 → slot 0 (swap)
      const output = await convertFixture(
        buf,
        [{ color: '#00FF00', type: 'PLA' }, { color: '#FF0000', type: 'PLA' }],
        { '1': 1, '2': 0 }
      );

      const xml = await output.file('Metadata/model_settings.config').async('string');
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const extruders = [...doc.querySelectorAll('metadata[key="extruder"]')].map(
        m => m.getAttribute('value')
      );
      // Original id 1 mapped to slot index 1 → extruder "2"
      // Original id 2 mapped to slot index 0 → extruder "1"
      expect(extruders).toContain('1');
      expect(extruders).toContain('2');
    });
  });

  describe('project_settings.config transformation', () => {
    it.each([
      ['quality', '0.16mm Standard @Snapmaker U1 (0.4 nozzle)', '0.16'],
      ['standard', '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', '0.2'],
      ['fast', '0.28mm Standard @Snapmaker U1 (0.4 nozzle)', '0.28'],
    ])('applies the %s official 0.4 mm process', async (processProfileId, settingsId, layerHeight) => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 },
        false,
        processProfileId
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.print_settings_id).toBe(settingsId);
      expect(json.layer_height).toBe(layerHeight);
      expect(json.nozzle_diameter).toEqual(['0.4', '0.4', '0.4', '0.4']);
    });

    it('writes the complete optimized quality parameters into the converted 3MF', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 },
        false,
        'quality'
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.outer_wall_speed).toEqual(['60', '60']);
      expect(json.inner_wall_speed).toEqual(['150', '150']);
      expect(json.sparse_infill_speed).toEqual(['200', '200']);
      expect(json.top_surface_speed).toEqual(['150', '150']);
      expect(json.default_acceleration).toEqual(['4000', '4000']);
      expect(json.outer_wall_acceleration).toEqual(['2000', '2000']);
      expect(json.top_shell_layers).toBe('6');
      expect(json.sparse_infill_pattern).toBe('gyroid');
    });

    it('sets correct filament colours as RGBA', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 }
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.filament_colour[0]).toBe('#FF0000FF');
    });

    it('maps filament types to correct settings IDs', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 }
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.filament_settings_id[0]).toBe('Snapmaker PLA SnapSpeed @U1');
    });

    it('writes the complete official material parameters for all supported materials', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
        { id: '2', color: '#00FF00', type: 'PETG' },
        { id: '3', color: '#0000FF', type: 'ABS' },
        { id: '4', color: '#FFFF00', type: 'TPU' },
      ]);
      const output = await convertFixture(
        buf,
        [
          { color: '#FF0000', type: 'PLA' },
          { color: '#00FF00', type: 'PETG-HF' },
          { color: '#0000FF', type: 'ABS' },
          { color: '#FFFF00', type: 'TPU' },
        ],
        { '1': 0, '2': 1, '3': 2, '4': 3 }
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.printer_settings_id).toBe('Snapmaker U1 (0.4 nozzle)');
      expect(json.print_settings_id).toBe('0.20mm Standard @Snapmaker U1 (0.4 nozzle)');
      expect(json.filament_type).toEqual(['PLA', 'PETG', 'ABS', 'TPU']);
      expect(json.filament_settings_id).toEqual([
        'Snapmaker PLA SnapSpeed @U1',
        'Snapmaker PETG HF',
        'Generic ABS',
        'Generic TPU',
      ]);
      expect(json.nozzle_temperature).toEqual(['220', '245', '270', '240']);
      expect(json.hot_plate_temp).toEqual(['65', '70', '90', '35']);
      expect(json.filament_max_volumetric_speed).toEqual(['20', '20', '15', '3.2']);
      expect(json.filament_flow_ratio).toEqual(['0.966', '0.95', '0.95', '1']);
      expect(json.machine_start_gcode).toContain('20260128');
    });

    it('applies support delta when hasSupport is true', async () => {
      const buf = await buildBambuSettingsZip(
        [{ color: '#FF0000FF', type: 'PLA' }],
        { hasSupport: true }
      );
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 },
        true
      );

      const json = JSON.parse(await output.file('Metadata/project_settings.config').async('string'));
      expect(json.enable_support).toBe('1');
    });
  });

  describe('ZIP assembly', () => {
    it('preserves geometry files unchanged', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 }
      );

      const model = await output.file('3D/3dmodel.model').async('string');
      expect(model).toBe('<model />');
    });

    it('excludes path traversal entries', async () => {
      const buf = await buildTraversalZip();
      const analysis = await analyze(buf);
      const blob = await convert({
        zip: analysis.zip,
        outputSlots: [{ color: '#FF0000', type: 'PLA' }],
        mapping: { '1': 0 },
        hasSupport: false,
      });

      const outputZip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
      const paths = Object.keys(outputZip.files);
      expect(paths).not.toContain('../evil.txt');
      expect(paths).not.toContain('/absolute.txt');
    });

    it('has exactly one XML declaration per file', async () => {
      const buf = await buildBambuSliceInfoZip([
        { id: '1', color: '#FF0000', type: 'PLA' },
      ]);
      const output = await convertFixture(
        buf,
        [{ color: '#FF0000', type: 'PLA' }],
        { '1': 0 }
      );

      const sliceInfo = await output.file('Metadata/slice_info.config').async('string');
      const declarations = sliceInfo.match(/<\?xml/g) || [];
      expect(declarations).toHaveLength(1);

      const modelSettings = await output.file('Metadata/model_settings.config').async('string');
      const declarations2 = modelSettings.match(/<\?xml/g) || [];
      expect(declarations2).toHaveLength(1);
    });
  });

  describe('missing metadata files', () => {
    it('handles missing slice_info.config without crashing', async () => {
      const zip = new JSZip();
      zip.file('Metadata/project_settings.config', JSON.stringify({
        filament_colour: ['#FF0000FF'],
        filament_type: ['PLA'],
        filament_settings_id: ['Generic PLA'],
      }));
      zip.file('Metadata/model_settings.config', '<?xml version="1.0"?><config></config>');
      zip.file('3D/3dmodel.model', '<model />');
      const buf = await zip.generateAsync({ type: 'arraybuffer' });

      const analysis = await analyze(buf);
      const blob = await convert({
        zip: analysis.zip,
        outputSlots: [{ color: '#FF0000', type: 'PLA' }],
        mapping: { '1': 0 },
        hasSupport: false,
      });

      expect(blob).toBeInstanceOf(Blob);
    });
  });
});
