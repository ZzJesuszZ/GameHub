// Tabla de consolas soportadas.
// libretro: nombre del sistema en thumbnails.libretro.com y en retroarch-assets.
// box: proporción ancho/alto de la caja original. emulator: id en emulators.js. core: core de RetroArch (si aplica).
// photo: foto de dominio público en Wikimedia Commons (Evan Amos) para el fondo del inicio.
// "pc" no es una consola: agrupa los juegos de Steam, Epic y los añadidos a mano.

const CONSOLES = [
  { id: 'pc', pc: true, box: 0.67, name: 'PC', maker: 'Steam · Epic Games · Otros', year: '', color: '#00e5ff', exts: [] },
  { id: 'nes', box: 0.72,  name: 'NES',             maker: 'Nintendo', year: 1983, color: '#c0392b', libretro: 'Nintendo - Nintendo Entertainment System',       exts: ['.nes', '.unf', '.zip', '.7z'],              emulator: 'retroarch', core: 'nestopia', photo: 'NES-Console-Set.jpg' },
  { id: 'snes', box: 1.38, name: 'Super Nintendo',  maker: 'Nintendo', year: 1990, color: '#7d5fff', libretro: 'Nintendo - Super Nintendo Entertainment System', exts: ['.sfc', '.smc', '.zip', '.7z'],              emulator: 'retroarch', core: 'snes9x', photo: 'SNES-Mod1-Console-Set.jpg' },
  { id: 'n64', box: 1.38,  name: 'Nintendo 64',     maker: 'Nintendo', year: 1996, color: '#27ae60', libretro: 'Nintendo - Nintendo 64',                         exts: ['.n64', '.z64', '.v64', '.zip', '.7z'],      emulator: 'retroarch', core: 'mupen64plus_next', photo: 'N64-Console-Set.jpg' },
  { id: 'gb', box: 1,   name: 'Game Boy',        maker: 'Nintendo', year: 1989, color: '#8e9a3a', libretro: 'Nintendo - Game Boy',                            exts: ['.gb', '.zip', '.7z'],                       emulator: 'retroarch', core: 'gambatte', photo: 'Game-Boy-FL.jpg' },
  { id: 'gbc', box: 1,  name: 'Game Boy Color',  maker: 'Nintendo', year: 1998, color: '#e67e22', libretro: 'Nintendo - Game Boy Color',                      exts: ['.gbc', '.zip', '.7z'],                      emulator: 'retroarch', core: 'gambatte', photo: 'Nintendo-Game-Boy-Color-FL.jpg' },
  { id: 'gba', box: 1,  name: 'Game Boy Advance',maker: 'Nintendo', year: 2001, color: '#5352ed', libretro: 'Nintendo - Game Boy Advance',                    exts: ['.gba', '.zip', '.7z'],                      emulator: 'retroarch', core: 'mgba', photo: 'Nintendo-Game-Boy-Advance-Purple-FL.jpg' },
  { id: 'nds', box: 1.1,  name: 'Nintendo DS',     maker: 'Nintendo', year: 2004, color: '#95a5a6', libretro: 'Nintendo - Nintendo DS',                         exts: ['.nds', '.zip', '.7z'],                      emulator: 'retroarch', core: 'melondsds', photo: 'Nintendo-DS-Lite-Black-Open.jpg' },
  { id: 'gc', box: 0.71,   name: 'GameCube',        maker: 'Nintendo', year: 2001, color: '#6c5ce7', libretro: 'Nintendo - GameCube',                            exts: ['.iso', '.gcm', '.rvz', '.ciso', '.gcz'],    emulator: 'dolphin', photo: 'GameCube-Console-Set.png' },
  { id: 'wii', box: 0.71,  name: 'Wii',             maker: 'Nintendo', year: 2006, color: '#00a8ff', libretro: 'Nintendo - Wii',                                 exts: ['.iso', '.wbfs', '.rvz', '.ciso', '.gcz', '.wad'], emulator: 'dolphin', photo: 'Wii-Console.png' },
  { id: 'ps1', box: 1,  name: 'PlayStation',     maker: 'Sony',     year: 1994, color: '#7f8c8d', libretro: 'Sony - PlayStation',                             exts: ['.cue', '.chd', '.pbp', '.m3u', '.iso'],     emulator: 'retroarch', core: 'swanstation', photo: 'PSX-Console-wController.jpg' },
  { id: 'ps2', box: 0.71,  name: 'PlayStation 2',   maker: 'Sony',     year: 2000, color: '#2e4fb8', libretro: 'Sony - PlayStation 2',                           exts: ['.iso', '.chd', '.cso', '.bin', '.gz'],      emulator: 'pcsx2', photo: 'Sony-PlayStation-2-30001-Console-FL.jpg' },
  { id: 'psp', box: 0.58,  name: 'PSP',             maker: 'Sony',     year: 2004, color: '#34495e', libretro: 'Sony - PlayStation Portable',                    exts: ['.iso', '.cso', '.pbp', '.chd'],             emulator: 'ppsspp', photo: 'Sony-PSP-1000-Body.png' },
];

const byId = Object.fromEntries(CONSOLES.map((c) => [c.id, c]));

module.exports = { CONSOLES, byId };
