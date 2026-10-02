// Lista las rutas de los procesos en ejecución (koffi + psapi), para saber si
// un juego de PC sigue abierto sin lanzar PowerShell cada vez.

const koffi = require('koffi');

let api = null;
function load() {
  if (api) return api;
  const psapi = koffi.load('psapi.dll');
  const kernel32 = koffi.load('kernel32.dll');
  api = {
    EnumProcesses: psapi.func('int __stdcall EnumProcesses(_Out_ uint32 *pids, uint32 cb, _Out_ uint32 *needed)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *h)'),
  };
  return api;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function processPaths() {
  const { EnumProcesses, OpenProcess, QueryFullProcessImageNameW, CloseHandle } = load();
  const pids = new Uint32Array(4096);
  const needed = [0];
  if (!EnumProcesses(pids, pids.byteLength, needed)) return [];
  const count = needed[0] / 4;
  const buf = new Uint16Array(1024);
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pids[i]);
    if (!h) continue;
    const size = [buf.length];
    if (QueryFullProcessImageNameW(h, 0, buf, size)) {
      out.push(String.fromCharCode(...buf.subarray(0, size[0])));
    }
    CloseHandle(h);
  }
  return out;
}

// ¿Hay algún proceso cuyo ejecutable esté dentro de `dir`?
function anyUnder(dir) {
  const prefix = dir.toLowerCase().replace(/[\\/]+$/, '') + '\\';
  return processPaths().some((p) => p.toLowerCase().startsWith(prefix));
}

module.exports = { processPaths, anyUnder };
