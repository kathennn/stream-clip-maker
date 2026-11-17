<div align="center">
  <img src="assets/stream-clip-maker-icon.png" alt="Stream Clip Maker app icon" width="144" />
  <img src="assets/stream-clip-maker-wordmark.png" alt="Stream Clip Maker" width="92%" />
</div>

# Stream Clip Maker

**Encuentra los mejores momentos de directos de Twitch y YouTube a partir de las reacciones del chat y conviértelos en clips.**

Stream Clip Maker analiza la actividad del chat para detectar momentos en los que reaccionan muchas personas distintas a la vez. Ordena los momentos destacados y puede generar los comandos de corte o ejecutar el flujo con FFmpeg, yt-dlp o TwitchDownloaderCLI.

- Detecta momentos destacados en chats JSON de TwitchDownloader y replay JSONL de YouTube.
- Puntúa picos de reacción según usuarios únicos, mensajes de reacción y una línea base móvil.
- Crea clips desde VODs de Twitch, URLs de YouTube o grabaciones locales.
- Exporta versiones verticales 9:16 con fondo desenfocado.
- Incluye herramientas opcionales para Android/Termux con subtítulos en español y título incrustado.

**No necesita dependencias Node.js de terceros.** Para descargar y renderizar vídeo hacen falta herramientas externas.

English: [README.md](README.md) · [Web oficial y descargas](https://kathennn.github.io/stream-clip-maker/)

## Descargas de escritorio — v0.1.0

Instaladores oficiales para Linux x64 y Windows x64. Cada enlace descarga directamente desde la release pública de GitHub.

| Plataforma | Paquete | Descarga directa |
| --- | --- | --- |
| Linux Debian / Ubuntu | DEB | [Descargar DEB](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_amd64.deb) |
| Linux Fedora | RPM | [Descargar RPM](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker-0.1.0-1.x86_64.rpm) |
| Linux portable | AppImage | [Descargar AppImage](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_amd64.AppImage) |
| Windows | MSI | [Descargar MSI](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_x64_en-US.msi) |
| Windows | EXE | [Descargar EXE](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_x64-setup.exe) |

Linux: instala DEB/RPM con tu gestor de paquetes. Para AppImage, aplica chmod +x al archivo descargado y ejecútalo. Windows: ejecuta el instalador MSI o EXE.

**macOS:** esta versión no tiene instalador nativo compatible. Utiliza la TUI guiada desde una copia del repositorio:

    git clone https://github.com/kathennn/stream-clip-maker.git
    cd stream-clip-maker
    npm install
    node cli.mjs

Instala Node.js 18+, FFmpeg y las herramientas necesarias. El menú incluye Search, Create, Enhance, Share, Setup & Help y Check. Renderizar o publicar requiere confirmación; no se publica nada automáticamente.

La aplicación procesa archivos localmente. Instala FFmpeg y yt-dlp o TwitchDownloaderCLI según tu flujo. Consulta la [web oficial de descargas](https://kathennn.github.io/stream-clip-maker/).

## Interfaz interactiva (TUI)

Ejecuta el programa sin argumentos para abrir el menú guiado:

```bash
stream-clip-maker
```

Desde el menú puedes analizar chats, crear clips desde VODs de Twitch / URLs compatibles / vídeos locales, descubrir directos y añadir subtítulos y títulos. Antes de renderizar vídeos pide confirmación. Nunca publica vídeos automáticamente.

También se mantienen los comandos y opciones tradicionales para usuarios avanzados.

## Instalación

Necesitas Node.js 18 o superior.

```bash
npm install --global stream-clip-maker
```

O ejecútalo sin instalación global:

```bash
npx stream-clip-maker --help
```

## Inicio rápido

Descarga primero el chat del directo:

```bash
# Chat de Twitch
TwitchDownloaderCLI chatdownload --id <ID_DEL_VOD> -o chat.json

# Replay del chat de YouTube
yt-dlp --skip-download --write-subs --sub-langs live_chat -o directo "<URL_YOUTUBE>"
```

Analiza el chat y muestra los comandos sugeridos:

```bash
stream-clip-maker chat.json --vod <ID_DEL_VOD> --vertical
stream-clip-maker directo.live_chat.json --url "<URL_YOUTUBE>" --vertical
```

Ejecuta los comandos y crea los clips:

```bash
stream-clip-maker chat.json --vod <ID_DEL_VOD> --vertical --run --out clips
stream-clip-maker directo.live_chat.json --url "<URL_YOUTUBE>" --vertical --run --out clips
stream-clip-maker chat.json --video grabacion.mp4 --vertical --run --out clips
```

Para revisar el plan sin descargar ni renderizar vídeos, usa `--preview`. El plan queda en `moments.json`, incluso si también se indica `--run`:

```bash
stream-clip-maker chat.json --vod <ID_DEL_VOD> --preview --run --out clips
```

Después, `--select` permite renderizar solo los momentos elegidos (números de la lista, empezando por 1):

```bash
stream-clip-maker chat.json --vod <ID_DEL_VOD> --select 1,3 --vertical --run --out clips
```

Todas las opciones:

```bash
stream-clip-maker --help
```

## Requisitos

- Node.js 18 o superior.
- FFmpeg para cortar y renderizar vídeo.
- Descargas de VODs de Twitch: [TwitchDownloaderCLI](https://github.com/lay295/TwitchDownloader).
- Descargas de YouTube: [yt-dlp](https://github.com/yt-dlp/yt-dlp).
- Flujo opcional en Android/Termux: Whisper.cpp y su modelo multilingüe base para generar subtítulos.

El análisis del chat no tiene dependencias Node.js de terceros. Para descargar y renderizar medios hacen falta las herramientas externas correspondientes.

## Cómo detecta los momentos destacados

- Divide el chat en ventanas de 10 segundos.
- Puntúa cada ventana según el número de usuarios únicos y la proporción de ellos que envían reacciones.
- Reduce el peso de ventanas dominadas por mensajes repetidos que parecen encuestas.
- Detecta candidatos cuando superan la línea base y el mínimo de personas que reaccionan.
- Une picos cercanos en un clip, hasta la duración máxima configurada.
- Por defecto ignora los tres primeros minutos para evitar picos de saludos.

La puntuación es heurística, no un modelo de inteligencia artificial. El chat puede reaccionar a lo que dice o hace el streamer, no solo al juego. Revisa siempre los momentos y los vídeos finales.

## Clips verticales

La opción `--vertical` crea una versión 9:16 con fondo desenfocado. Actualmente no incluye seguimiento automático de caras ni reencuadre inteligente del sujeto.

## Herramientas Android / Termux

El repositorio también incluye scripts opcionales para Android:

- `make-clips.sh`: descarga el chat de un VOD de Twitch, detecta momentos, crea clips verticales, añade subtítulos en español y título, y copia los resultados a Descargas.
- `enhance-clip.sh`: transcribe voz en español con Whisper.cpp e incrusta título y subtítulos.
- `discover-twitch.sh`: busca directos por categoría usando Twitch Helix.
- `youtube-auth.mjs` y `youtube-upload.mjs`: autorización local OAuth y subida privada a YouTube.
- `publish-short.sh`: valida un MP4 final 1080×1920 de hasta 180 segundos antes de subirlo.

Estos scripts están diseñados para el entorno Termux del proyecto y requieren herramientas y configuración locales adicionales. No es un servicio alojado y no publica automáticamente.

### Configurar la búsqueda de Twitch

1. Crea una aplicación en [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Copia `.env.example` a `.env` y completa `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET`.
3. Añade en `allowedCreators` de `rules.json` los nombres de creadores cuyo contenido tienes permiso para editar.
4. Ejecuta `./discover-twitch.sh "GTA 6"` desde una copia del repositorio.

Los canales encontrados **no quedan autorizados automáticamente**. Solo los creadores incluidos expresamente en `allowedCreators` aparecen como autorizados. Encontrar un directo mediante la API de Twitch no concede permiso para reutilizar su contenido.

### Seguridad al subir a YouTube

El uploader exige la opción explícita `--confirm-rights`, solo acepta archivos terminados en `_final.mp4`, comprueba la resolución 1080×1920 y la duración máxima de 180 segundos, y sube los vídeos como privados. Revisa el clip, los permisos del creador, el título y la descripción antes de publicar.

## Plugins para ChatGPT

El repositorio incluye dos paquetes de plugins de instrucciones listos para importar:

- [Asistente Stream Clip Maker — ZIP](plugins/stream-clip-maker-assistant.zip): guía a ChatGPT en la instalación, análisis de chats de Twitch/YouTube, uso de la app de escritorio y TUI, renderizado y solución de problemas.
- [Guía Remote Desktop Commander — ZIP](plugins/remote-desktop-commander-guide.zip): explica conexión de dispositivos, terminal, archivos, Git/despliegues y seguridad.

Para usarlos con ChatGPT, descarga el ZIP e impórtalo mediante Plugin Creator o el flujo de importación de plugins disponible en tu cuenta. Cuando esté guardado, selecciona el plugin en una conversación y describe la tarea.

**Importante:** son plugins de instrucciones/skills, no servidores de ejecución remota. La guía de Remote Desktop Commander no concede acceso al ordenador. Conecta por separado la integración oficial de Remote Desktop Commander y autoriza tu dispositivo; después utiliza la guía junto a esa integración. Consulta las carpetas de cada plugin para ver todos los detalles.

## Desarrollo

```bash
npm run check
npm test
npm pack --dry-run
```

## Licencia

MIT. Consulta [LICENSE](LICENSE).
