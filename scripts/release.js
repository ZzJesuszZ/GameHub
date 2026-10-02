// Publica una versión nueva en GitHub Releases usando la CLI `gh`.
// Uso: sube "version" en package.json, haz commit y push, y ejecuta
//   npm run release                 (notas generadas a partir de los commits)
//   npm run release -- notas.md     (notas propias desde un archivo Markdown; en Windows
//                                    npm corta los textos de varias líneas pasados directamente)
//
// Se compila sin publicar y luego se suben juntos el instalador, su .blockmap
// (descarga diferencial) y latest.yml (lo que lee el actualizador de la app).

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = `v${version}`;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

if (run('git', ['status', '--porcelain'])) {
  console.error('Hay cambios sin commit. Haz commit y push antes de publicar.');
  process.exit(1);
}
const exists = spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }).status === 0;
if (exists) {
  console.error(`La versión ${tag} ya está publicada. Sube "version" en package.json.`);
  process.exit(1);
}

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const build = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const exe = `GameHub-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(root, 'dist', f));
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`Falta ${f}`);
    process.exit(1);
  }
}

const notesFile = process.argv[2];
if (notesFile && !fs.existsSync(notesFile)) {
  console.error(`No existe el archivo de notas ${notesFile}`);
  process.exit(1);
}
const args = ['release', 'create', tag, ...files, '--title', `GameHub ${version}`, '--target', run('git', ['rev-parse', 'HEAD'])];
args.push(...(notesFile ? ['--notes-file', notesFile] : ['--generate-notes']));
const publish = spawnSync('gh', args, { cwd: root, stdio: 'inherit' });
process.exit(publish.status ?? 1);
