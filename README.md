# GameHub

Lanzador de emuladores para Windows, pensado para usarse con el mando de Xbox.

## Instalar
Descarga el instalador `GameHub-Setup-x.y.z.exe` de la última versión en
[Releases](https://github.com/ZzJesuszZ/GameHub/releases/latest) y ejecútalo. En el primer arranque, el asistente te pide la carpeta de juegos
y qué emuladores descargar. Los que ya tengas instalados (p. ej. PCSX2) se detectan solos.

## Juegos de PC
La tarjeta **PC** reúne los juegos instalados de **Steam** y **Epic Games** (se detectan solos) y los que añadas a mano
en Ajustes → Juegos de PC (.exe o acceso directo). Las portadas salen siempre de Steam (de la caché de tu PC o de su
tienda); la clave de SteamGridDB nunca las sustituye, solo se usa para los juegos añadidos a mano que no estén en
Steam. Al cerrar el juego, GameHub vuelve solo. Durante un juego de PC, el combo del mando muestra GameHub encima,
pero no cierra el juego.

## Conseguir juegos
GameHub no distribuye ni enlaza a ROMs de juegos comerciales. Cuando una consola no tiene juegos, el botón **Y**
("Juegos gratis") abre en itch.io —una web segura— los juegos homebrew y freeware gratuitos y legales de esa consola.
Para el resto, usa copias de seguridad de tus propios juegos.

## Apariencia
Ajustes → Apariencia → Estilo: neón con el color de cada consola, neón cian + magenta, mezcla o clásico.
Al pasar por cada consola se ve una foto suya (Wikimedia Commons, dominio público), recortada en memoria.

## Actualizaciones
Al arrancar, GameHub comprueba si hay una versión nueva en GitHub y **pregunta** antes de hacer nada:
"Actualizar ahora", "Ahora no" u "Omitir esta versión". También se puede actualizar en cualquier momento en
**Ajustes → Actualizaciones**. La descarga es diferencial (solo las partes que cambian; la primera vez tras
instalar a mano se descarga completa) y, tras instalarse,
GameHub se vuelve a abrir solo. Nunca se muestra el aviso en mitad de un juego.

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

### Publicar una versión nueva
1. Sube `version` en `package.json` (p. ej. `1.1.0` → `1.1.1`) y haz commit y push.
2. `npm run release` — compila el instalador y lo publica como Release en GitHub (usa la sesión de `gh`).
   Las notas se generan a partir de los commits; para escribirlas tú: `npm run release -- notas.md`.
3. Las apps instaladas verán el aviso de actualización en su siguiente arranque.

Para probar el actualizador sin instalar: `GAMEHUB_UPDATE_TEST=1 GAMEHUB_FAKE_VERSION=1.0.0 npm start`.
