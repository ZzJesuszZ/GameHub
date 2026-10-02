// Publica una versión nueva en GitHub Releases usando la sesión de la CLI `gh`.
// Uso: sube "version" en package.json, haz commit y ejecuta `npm run release`.
const { execFileSync, spawnSync } = require('child_process');

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const result = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
process.exit(result.status ?? 1);
