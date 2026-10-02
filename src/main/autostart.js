// Inicio con Windows y "traer al frente" de la ventana.

const { app } = require('electron');
const koffi = require('koffi');

function setAutostart(enabled) {
  if (!app.isPackaged) {
    // En desarrollo hay que pasar la ruta del proyecto a electron.exe
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath(), '--background'] });
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] });
  }
}

let user32 = null;
function win32() {
  if (!user32) {
    const lib = koffi.load('user32.dll');
    user32 = {
      keybd_event: lib.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
      SetForegroundWindow: lib.func('int __stdcall SetForegroundWindow(intptr hWnd)'),
    };
  }
  return user32;
}

// Windows no deja que un proceso en segundo plano robe el foco. Simular la
// tecla Alt hace que el sistema considere que ha habido entrada del usuario.
function bringToFront(win, fullscreen = true) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  try {
    const { keybd_event, SetForegroundWindow } = win32();
    const VK_MENU = 0x12, KEYUP = 0x0002;
    keybd_event(VK_MENU, 0, 0, 0);
    keybd_event(VK_MENU, 0, KEYUP, 0);
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
    SetForegroundWindow(hwnd);
  } catch { /* si falla, focus() de Electron suele bastar */ }
  win.focus();
  if (fullscreen) win.setFullScreen(true);
  setTimeout(() => win.setAlwaysOnTop(false), 400);
}

module.exports = { setAutostart, bringToFront };
