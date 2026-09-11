'use strict';

const archiver = require('archiver');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const packageJson = require('../package.json');

async function main() {
  const root = path.resolve(__dirname, '..');
  const release = path.join(root, 'release');
  const destination = path.join(
    release,
    `Tridibox-3MF-to-U1-Desktop-${packageJson.version}-Codigo-Fuente.zip`
  );
  await fsp.mkdir(release, { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.glob('**/*', {
      cwd: root,
      dot: true,
      ignore: [
        '.git/**',
        'node_modules/**',
        'release/**',
      ],
    }, { prefix: 'Tridibox-3MF-to-U1-Desktop' });
    archive.finalize();
  });

  process.stdout.write(`${destination}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
