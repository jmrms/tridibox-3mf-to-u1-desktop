import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, '../..');
const htmlPath = path.join(projectRoot, 'src', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const styles = fs.readFileSync(path.join(projectRoot, 'src', 'styles.css'), 'utf8');
const document = new JSDOM(html).window.document;

describe('desktop user interface', () => {
  it('contains every control required by the renderer', () => {
    const requiredIds = [
      'drop-zone', 'btn-open', 'btn-settings', 'btn-convert', 'btn-original',
      'btn-new', 'slots-strip', 'input-list', 'settings-overlay',
      'setting-watch', 'setting-folder', 'setting-startup', 'setting-tray',
      'setting-auto', 'setting-material', 'btn-settings-save',
      'btn-open-orca', 'verification-summary', 'verification-list', 'profile-version',
      'process-options',
    ];
    for (const id of requiredIds) expect(document.getElementById(id), id).not.toBeNull();
  });

  it('does not contain duplicate element IDs', () => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loads scripts and styles only from local paths', () => {
    const urls = [
      ...[...document.querySelectorAll('script[src]')].map(element => element.getAttribute('src')),
      ...[...document.querySelectorAll('link[href]')].map(element => element.getAttribute('href')),
    ];
    expect(urls.every(url => !/^https?:/i.test(url))).toBe(true);
    for (const relativeUrl of urls) {
      const resolved = path.resolve(path.dirname(htmlPath), relativeUrl);
      expect(fs.existsSync(resolved), relativeUrl).toBe(true);
    }
  });

  it('blocks network connections through its content security policy', () => {
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content;
    expect(policy).toContain("connect-src 'none'");
  });

  it('keeps the Tridibox signature visible in the fixed footer', () => {
    expect(document.querySelector('footer')?.textContent).toContain('Powered for Tridibox');
    expect(styles).toMatch(/footer\s*\{[^}]*position:\s*fixed;/s);
  });
});
