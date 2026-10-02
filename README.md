# GameHub

Lanzador de emuladores para Windows, pensado para usarse con el mando de Xbox.

## Instalar
Ejecuta `dist/GameHub Setup 1.0.0.exe`. En el primer arranque, el asistente te pide la carpeta de juegos
y qué emuladores descargar. Los que ya tengas instalados (p. ej. PCSX2) se detectan solos.

## Juegos de PC
La tarjeta **PC** reúne los juegos instalados de **Steam** y **Epic Games** (se detectan solos) y los que añadas a mano
en Ajustes → Juegos de PC (.exe o acceso directo). Las portadas salen de la caché de Steam de tu PC o de la tienda
de Steam; con una clave de SteamGridDB, también de SteamGridDB. Al cerrar el juego, GameHub vuelve solo.
Durante un juego de PC, el combo del mando muestra GameHub encima, pero no cierra el juego.

## Apariencia
Ajustes → Apariencia → Estilo: neón con el color de cada consola, neón cian + magenta, mezcla o clásico.
Al pasar por cada consola se ve una foto suya (Wikimedia Commons, dominio público), recortada en memoria.

## Dónde van las cosas
- **Juegos:** `Documentos\Juegos\roms\<consola>\` → `nes`, `snes`, `n64`, `gb`, `gbc`, `gba`, `nds`, `gc`, `wii`, `ps1`, `ps2`, `psp`
- **BIOS:** `%APPDATA%\GameHub\bios\psx` (PS1) y `bios\ps2` (PS2, si usas el PCSX2 de GameHub)
- **Emuladores:** `%APPDATA%\GameHub\emulators\` (modo portable; las partidas guardadas quedan ahí)

## Mando
Funciona con mandos de Xbox, PlayStation (incluidos clones genéricos), Switch Pro y la mayoría de genéricos (lectura con SDL3).

| Xbox | PlayStation | Acción |
|---|---|---|
| Cruceta / stick | Cruceta / stick | Moverse |
| A | ✕ | Abrir / Jugar |
| B | ○ | Atrás (en inicio: ocultar a la bandeja) |
| Y | △ | Favorito |
| X | □ | Solo favoritos |
| LB / RB | L1 / R1 | Consola anterior / siguiente |
| Menu | Options | Ajustes |
| **View + Menu 1 s** | **Share + Options 1 s** | Abrir GameHub desde cualquier sitio |
| **ídem 2 s** (jugando) | **ídem 2 s** (jugando) | Cerrar el juego y volver |

El combo se puede cambiar en Ajustes (también existe la opción "Botón PS / Xbox").
En RetroArch, **L3 + R3** abre su menú (guardar/cargar estado, etc.).
Teclado: flechas, Enter, Esc, F (favorito), X, Q/E, Tab.

## Desarrollo
```
npm install
npm start                # pantalla completa
npx electron . --windowed
npm run dist             # genera el instalador en dist/
```
La variable `GAMEHUB_DATA` permite usar otra carpeta de datos para pruebas.
