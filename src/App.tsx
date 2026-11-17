import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity, ArrowRight, Check, ChevronDown, CircleHelp, Clapperboard, FileVideo,
  FolderOpen, Globe2, Home, Languages, LoaderCircle, Menu, MessageCircle, Play,
  Search, Settings, Share2, ShieldCheck, SlidersHorizontal, Sparkles, Subtitles,
  Upload, Video, X, Zap,
} from "lucide-react";

type Page = "home" | "discover" | "create" | "live" | "enhance" | "share" | "connections" | "settings" | "help";
type Locale = "en" | "es";
type LogLine = { taskId: string; stream: string; line: string };
type TaskFinished = { taskId: string; success: boolean; code: number | null };

const copy = {
  en: {
    home:"Overview", discover:"Discover", create:"Create clips", enhance:"Enhance", share:"Share",
    connections:"Connections", settings:"Settings", help:"Help center", greeting:"Make your next highlight.",
    sub:"Find the moments people remember. Turn them into vertical clips, add captions, and share when you're ready.",
    discoverNow:"Find streams", createNow:"Create a clip", setup:"Connect your accounts",
    quick:"Quick actions", status:"Workspace status", ready:"Ready to create", local:"Everything runs on your device",
    privacy:"Your credentials and video files stay local. Nothing is published without your confirmation.",
    connected:"Connected", notConnected:"Not connected", twitch:"Twitch", youtube:"YouTube",
    discoverTitle:"Find streams worth clipping", discoverSub:"Search Twitch by game or category and review live channels and archived VODs.",
    topic:"Game or category", searchPlaceholder:"Try GTA 6, Minecraft, Just Chatting…", search:"Search Twitch",
    results:"Discovery results", noResults:"No search yet. Search for a game or category to see matching channels.",
    createTitle:"Turn chat reactions into clips", createSub:"Choose a chat replay and a video source. Review detected moments before rendering.",
    chatFile:"Chat replay file", chooseFile:"Choose file", source:"Video source", twitchVod:"Twitch VOD", videoUrl:"Video URL",
    localVideo:"Video on this device", analysisOnly:"Analyze chat only", vodId:"Twitch VOD ID", url:"Video URL",
    top:"Number of moments", output:"Output folder", vertical:"Create vertical 9:16 clips", render:"Render selected clips",
    analyze:"Analyze moments", permission:"I have permission to use this content.", confirmRender:"Start video rendering? This may take several minutes per clip.",
    enhanceTitle:"Add subtitles and a title", enhanceSub:"Turn a vertical clip into a polished, captioned video.",
    inputVideo:"Vertical MP4", overlayTitle:"Title on the video", enhanceAction:"Create subtitles and final video",
    shareTitle:"Share your finished video", shareSub:"Upload a reviewed video to your connected YouTube account as private.",
    finalVideo:"Finished _final.mp4 file", videoTitle:"YouTube title", description:"Description", tags:"Tags (comma separated)",
    rights:"I own this video or have explicit permission to publish it.", uploadPrivate:"Upload as private",
    connectionsTitle:"Connect your accounts", connectionsSub:"Connect Twitch to discover streams and YouTube to upload finished clips.",
    twitchClient:"Twitch Client ID", twitchSecret:"Twitch Client Secret", saveTwitch:"Save Twitch connection",
    youtubeSetup:"YouTube OAuth credentials", chooseJson:"Choose OAuth JSON file", connectYoutube:"Start YouTube connection",
    youtubeNote:"Create a Desktop OAuth client in Google Cloud and enable YouTube Data API v3. Your token is stored locally.",
    settingsTitle:"Preferences", language:"App language", english:"English", spanish:"Español",
    helpTitle:"How can we help?", helpSub:"Follow these simple guides to get from a stream to a finished Short.",
    guide1:"1. Connect Twitch and YouTube", guide1Text:"Add your Twitch app keys. For YouTube, create a Desktop OAuth client in Google Cloud and connect it here.",
    guide2:"2. Find a stream", guide2Text:"Search Twitch by game or category. Discovery does not grant permission to reuse a creator's content.",
    guide3:"3. Get a chat replay", guide3Text:"Use TwitchDownloaderCLI for Twitch chat replays, or yt-dlp for available YouTube live chat replays.",
    guide4:"4. Create your clips", guide4Text:"Select a chat file and video source. Analyze first, review the moments, then render vertical clips.",
    guide5:"5. Add captions", guide5Text:"Install FFmpeg and Whisper.cpp with a multilingual model. Choose a vertical MP4 and add a title.",
    guide6:"6. Upload privately", guide6Text:"Review your _final.mp4, upload it as private, then choose Public or Schedule yourself in YouTube Studio.",
    logs:"Activity", waiting:"Waiting for your next action", runInDesktop:"Connect the desktop backend to run this action.",
    demo:"Preview mode", desktopOnly:"This action runs in the installed desktop app.", save:"Save changes", saved:"Saved",
    processing:"Working…", done:"Finished", failed:"Something went wrong", select:"Select", cancel:"Cancel",
    noCredentials:"Twitch is not connected yet. Add your Client ID and Secret in Connections.",
    safe:"Nothing is uploaded or published without your confirmation.",
    live:"Live clipper", liveTitle:"Clip authorized Twitch channels live",
    liveSub:"Detect chat reaction peaks while the stream is running and save local clip drafts.",
    liveChannels:"Authorized Twitch channels (comma-separated)",
    liveRights:"I have permission to capture and create clips from these channels.",
    saveAllowlist:"Save authorized channels", startCapture:"Start live capture",
    startChatOnly:"Test chat only (5 min)", stopCapture:"Stop capture",
    liveHint:"Channels are stored in your local allowlist. Discovery does not grant reuse rights. Nothing is uploaded.",
    liveRunning:"Live task running", liveStopped:"Live task stopped",
  },
  es: {
    home:"Resumen", discover:"Descubrir", create:"Crear clips", enhance:"Mejorar", share:"Compartir",
    connections:"Conexiones", settings:"Ajustes", help:"Centro de ayuda", greeting:"Crea tu próximo momentazo.",
    sub:"Encuentra los momentos que todos recuerdan. Conviértelos en clips verticales, añade subtítulos y compártelos cuando quieras.",
    discoverNow:"Buscar directos", createNow:"Crear un clip", setup:"Conectar tus cuentas",
    quick:"Acciones rápidas", status:"Estado del espacio", ready:"Listo para crear", local:"Todo se procesa en tu dispositivo",
    privacy:"Tus credenciales y vídeos permanecen en local. Nada se publica sin tu confirmación.",
    connected:"Conectado", notConnected:"No conectado", twitch:"Twitch", youtube:"YouTube",
    discoverTitle:"Encuentra directos para crear clips", discoverSub:"Busca en Twitch por juego o categoría y revisa canales en directo y VODs.",
    topic:"Juego o categoría", searchPlaceholder:"Prueba GTA 6, Minecraft, Just Chatting…", search:"Buscar en Twitch",
    results:"Resultados", noResults:"Todavía no hay búsquedas. Busca un juego o categoría para ver canales.",
    createTitle:"Convierte las reacciones del chat en clips", createSub:"Elige una repetición del chat y el vídeo. Revisa los momentos antes de renderizar.",
    chatFile:"Archivo de chat", chooseFile:"Elegir archivo", source:"Origen del vídeo", twitchVod:"VOD de Twitch",
    videoUrl:"URL de vídeo", localVideo:"Vídeo de este dispositivo", analysisOnly:"Solo analizar el chat",
    vodId:"ID del VOD de Twitch", url:"URL del vídeo", top:"Número de momentos", output:"Carpeta de salida",
    vertical:"Crear clips verticales 9:16", render:"Renderizar clips seleccionados", analyze:"Analizar momentos",
    permission:"Tengo permiso para utilizar este contenido.", confirmRender:"¿Iniciar el renderizado? Puede tardar varios minutos por clip.",
    enhanceTitle:"Añade subtítulos y un título", enhanceSub:"Convierte un clip vertical en un vídeo terminado.",
    inputVideo:"MP4 vertical", overlayTitle:"Título del vídeo", enhanceAction:"Crear subtítulos y vídeo final",
    shareTitle:"Comparte tu vídeo terminado", shareSub:"Sube un vídeo revisado a YouTube como privado.",
    finalVideo:"Archivo _final.mp4", videoTitle:"Título de YouTube", description:"Descripción", tags:"Etiquetas (separadas por comas)",
    rights:"Soy propietario del vídeo o tengo permiso explícito para publicarlo.", uploadPrivate:"Subir como privado",
    connectionsTitle:"Conecta tus cuentas", connectionsSub:"Conecta Twitch para descubrir directos y YouTube para subir clips.",
    twitchClient:"Twitch Client ID", twitchSecret:"Twitch Client Secret", saveTwitch:"Guardar conexión de Twitch",
    youtubeSetup:"Credenciales OAuth de YouTube", chooseJson:"Elegir archivo OAuth JSON", connectYoutube:"Conectar con YouTube",
    youtubeNote:"Crea un cliente OAuth de escritorio en Google Cloud y activa YouTube Data API v3. El token se guarda localmente.",
    settingsTitle:"Preferencias", language:"Idioma de la aplicación", english:"English", spanish:"Español",
    helpTitle:"¿En qué podemos ayudarte?", helpSub:"Sigue estas guías para pasar de un directo a un Short terminado.",
    guide1:"1. Conecta Twitch y YouTube", guide1Text:"Añade tus claves de Twitch. Para YouTube, crea un cliente OAuth de escritorio en Google Cloud y conéctalo aquí.",
    guide2:"2. Encuentra un directo", guide2Text:"Busca en Twitch por juego o categoría. Encontrar un canal no concede permiso para reutilizar su contenido.",
    guide3:"3. Consigue la repetición del chat", guide3Text:"Usa TwitchDownloaderCLI para Twitch o yt-dlp para las repeticiones disponibles de YouTube.",
    guide4:"4. Crea tus clips", guide4Text:"Selecciona un chat y un vídeo. Analiza primero, revisa los momentos y después crea los clips verticales.",
    guide5:"5. Añade subtítulos", guide5Text:"Instala FFmpeg y Whisper.cpp con un modelo multilingüe. Selecciona un MP4 vertical y añade un título.",
    guide6:"6. Sube en privado", guide6Text:"Revisa tu _final.mp4, súbelo como privado y elige Público o Programar desde YouTube Studio.",
    logs:"Actividad", waiting:"Esperando tu siguiente acción", runInDesktop:"Conecta el backend de escritorio para ejecutar esta acción.",
    demo:"Modo vista previa", desktopOnly:"Esta acción se ejecuta en la aplicación de escritorio instalada.", save:"Guardar cambios",
    saved:"Guardado", processing:"Procesando…", done:"Terminado", failed:"Ha ocurrido un error", select:"Seleccionar",
    cancel:"Cancelar", noCredentials:"Twitch todavía no está conectado. Añade tu Client ID y Secret en Conexiones.",
    safe:"Nada se sube ni se publica sin tu confirmación.",
    live:"Clipper en directo", liveTitle:"Crea clips de canales autorizados en directo",
    liveSub:"Detecta picos de reacción del chat mientras el directo sigue activo y guarda borradores locales.",
    liveChannels:"Canales de Twitch autorizados (separados por comas)",
    liveRights:"Tengo permiso para capturar y crear clips de estos canales.",
    saveAllowlist:"Guardar canales autorizados", startCapture:"Iniciar captura en directo",
    startChatOnly:"Probar solo el chat (5 min)", stopCapture:"Detener captura",
    liveHint:"Los canales se guardan en tu lista local. Descubrir un canal no concede derechos de reutilización. No se sube nada.",
    liveRunning:"Tarea en directo activa", liveStopped:"Tarea en directo detenida",
  },
} as const;

const nav: { id: Page; icon: typeof Home; key: keyof typeof copy.en }[] = [
  { id:"home", icon:Home, key:"home" }, { id:"discover", icon:Search, key:"discover" },
  { id:"create", icon:Clapperboard, key:"create" }, { id:"live", icon:Activity, key:"live" },
  { id:"enhance", icon:Subtitles, key:"enhance" },
  { id:"share", icon:Share2, key:"share" }, { id:"connections", icon:Globe2, key:"connections" },
  { id:"settings", icon:Settings, key:"settings" }, { id:"help", icon:CircleHelp, key:"help" },
];

export default function App() {
  const [page,setPage] = useState<Page>("home");
  const [locale,setLocale] = useState<Locale>((localStorage.getItem("scm-locale") as Locale) || "en");
  const [topic,setTopic] = useState("");
  const [chat,setChat] = useState("");
  const [source,setSource] = useState("analysis");
  const [video,setVideo] = useState("");
  const [vod,setVod] = useState("");
  const [url,setUrl] = useState("");
  const [top,setTop] = useState("10");
  const [output,setOutput] = useState("clips");
  const [vertical,setVertical] = useState(true);
  const [permission,setPermission] = useState(false);
  const [enhanceInput,setEnhanceInput] = useState("");
  const [clipTitle,setClipTitle] = useState("BEST MOMENT");
  const [shareInput,setShareInput] = useState("");
  const [shareTitle,setShareTitle] = useState("");
  const [description,setDescription] = useState("");
  const [tags,setTags] = useState("");
  const [rights,setRights] = useState(false);
  const [clientId,setClientId] = useState("");
  const [clientSecret,setClientSecret] = useState("");
  const [twitchConnected,setTwitchConnected] = useState(false);
  const [youtubeConnected,setYoutubeConnected] = useState(false);
  const [searchResults,setSearchResults] = useState<any>(null);
  const [logs,setLogs] = useState<string[]>([]);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [liveChannels,setLiveChannels] = useState("");
  const [liveRights,setLiveRights] = useState(false);
  const [liveTaskId,setLiveTaskId] = useState<string | null>(null);
  const finishedTasks = useRef(new Set<string>());
  const [mobileOpen,setMobileOpen] = useState(false);
  const t = (key: keyof typeof copy.en) => copy[locale][key] || copy.en[key];

  useEffect(() => {
    localStorage.setItem("scm-locale",locale);
  },[locale]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenOutput: (()=>void)|undefined;
    let unlistenDone: (()=>void)|undefined;
    (async () => {
      unlistenOutput = await listen<LogLine>("task-output",e => setLogs(old=>[...old.slice(-180),e.payload.line]));
      unlistenDone = await listen<TaskFinished>("task-finished",e => {
        setBusy(false);
        finishedTasks.current.add(e.payload.taskId);
        setLiveTaskId(current => {
          if (current !== e.payload.taskId) return current;
          finishedTasks.current.delete(e.payload.taskId);
          return null;
        });
        setNotice(e.payload.success ? t("done") : t("failed"));
        if (e.payload.success) { refreshDiscovery(); invoke<{twitchConnected:boolean;youtubeConnected:boolean}>("connection_status").then(v=>{setTwitchConnected(v.twitchConnected);setYoutubeConnected(v.youtubeConnected);}).catch(()=>{}); }
      });
      const status = await invoke<{twitchConnected:boolean;youtubeConnected:boolean}>("connection_status").catch(()=>null);
      if (status) { setTwitchConnected(status.twitchConnected); setYoutubeConnected(status.youtubeConnected); }
      const allowed = await invoke<string[]>("read_live_allowlist").catch(()=>[]);
      setLiveChannels(allowed.join(", "));
    })();
    return () => { unlistenOutput?.(); unlistenDone?.(); };
  },[]);

  async function refreshDiscovery() {
    if (!isTauri()) return;
    const data = await invoke<any>("read_discovery").catch(()=>null);
    if (data) setSearchResults(data);
  }

  async function pickFile(filters: {name:string;extensions:string[]}[]) {
    if (!isTauri()) { setNotice(t("desktopOnly")); return ""; }
    const selected = await open({ multiple:false, filters });
    return typeof selected === "string" ? selected : "";
  }

  async function runTask(script:string,args:string[]) {
    setNotice("");
    if (!isTauri()) {
      setLogs(old=>[...old,"> "+script+" "+args.join(" "),t("runInDesktop")]);
      setNotice(t("demo"));
      return;
    }
    setBusy(true);
    try {
      await invoke("start_engine_task",{script,args});
    } catch (e) {
      setBusy(false);
      setNotice(String(e));
    }
  }

  function selectedLiveChannels() {
    return liveChannels.split(/[,\s]+/).map(channel => channel.trim().toLowerCase()).filter(Boolean);
  }

  async function saveLiveAllowlist() {
    if (!isTauri()) { setNotice(t("desktopOnly")); return; }
    if (!liveRights) { setNotice(t("liveRights")); return; }
    try {
      const channels = await invoke<string[]>("save_live_allowlist", {
        channels: selectedLiveChannels(), rightsConfirmed: liveRights,
      });
      setLiveChannels(channels.join(", "));
      setNotice(t("saved"));
    } catch (e) { setNotice(String(e)); }
  }

  async function startLiveCapture(chatOnly: boolean) {
    if (!isTauri()) { setNotice(t("desktopOnly")); return; }
    if (!liveRights) { setNotice(t("liveRights")); return; }
    const channels = selectedLiveChannels();
    if (!channels.length) { setNotice(t("liveChannels")); return; }
    if (busy || liveTaskId) return;
    try {
      const allowed = await invoke<string[]>("save_live_allowlist", {
        channels, rightsConfirmed: liveRights,
      });
      setLiveChannels(allowed.join(", "));
      const args = [...allowed];
      if (chatOnly) args.push("--chat-only", "--minutes", "5");
      setBusy(true);
      const taskId = await invoke<string>("start_engine_task", { script:"live-clips.mjs", args });
      if (finishedTasks.current.has(taskId)) finishedTasks.current.delete(taskId);
      else setLiveTaskId(taskId);
      setLogs(old => [...old, "> live-clips.mjs " + args.join(" ")]);
      setNotice(t("liveRunning"));
    } catch (e) { setBusy(false); setNotice(String(e)); }
  }

  async function stopLiveCapture() {
    if (!liveTaskId || !isTauri()) return;
    try {
      await invoke("stop_engine_task", { taskId: liveTaskId });
      setNotice(locale === "en" ? "Stopping live capture and finishing queued clips…" : "Deteniendo la captura y terminando los clips pendientes…");
    } catch (e) { setNotice(String(e)); }
  }

  async function doSearch() {
    if (!topic.trim()) return;
    if (!twitchConnected && isTauri()) { setNotice(t("noCredentials")); setPage("connections"); return; }
    await runTask("discover-twitch.mjs",[topic.trim()]);
  }

  async function doCreate() {
    if (!chat) { setNotice(t("chatFile")); return; }
    const args = [chat,"--top",top,"--out",output];
    if (vertical) args.push("--vertical");
    if (source === "twitch") args.push("--vod",vod);
    if (source === "youtube") args.push("--url",url);
    if (source === "local") args.push("--video",video);
    if (source !== "analysis" && !permission) { setNotice(t("permission")); return; }
    if (source !== "analysis") args.push("--run");
    await runTask("chat-clips.mjs",args);
  }

  async function doEnhance() {
    if (!enhanceInput) return;
    await runTask("desktop-engine.mjs",["enhance",enhanceInput,clipTitle]);
  }

  async function doUpload() {
    if (!shareInput || !rights) return;
    const args=[shareInput,shareTitle || "My highlight #Shorts","--confirm-rights"];
    if (description) args.push("--description",description);
    if (tags) args.push("--tags",tags);
    await runTask("youtube-upload.mjs",args);
  }

  async function saveTwitch() {
    if (!isTauri()) { setNotice(t("desktopOnly")); return; }
    try {
      await invoke("save_twitch_credentials",{clientId,clientSecret});
      setTwitchConnected(true); setClientSecret(""); setNotice(t("saved"));
    } catch(e) { setNotice(String(e)); }
  }

  async function connectYoutube() {
    const path=await pickFile([{name:"OAuth client JSON",extensions:["json"]}]);
    if (!path) return;
    try {
      await invoke("import_youtube_credentials",{path});
      await runTask("youtube-auth.mjs",[]);
    } catch(e) { setNotice(String(e)); }
  }

  const pageTitle = t(nav.find(n=>n.id===page)!.key);
  const headerHint = useMemo(()=>locale==="en"?"Your creator workspace":"Tu espacio de creación",[locale]);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen?"sidebar-open":""}`}>
      <div className="brand">
        <div className="brand-mark"><img src="/assets/stream-clip-maker-icon.png" /></div>
        <div><strong>Stream Clip Maker</strong><span>DESKTOP STUDIO</span></div>
        <button className="mobile-close icon-btn" onClick={()=>setMobileOpen(false)}><X size={17}/></button>
      </div>
      <div className="workspace-label">{locale==="en"?"WORKSPACE":"ESPACIO DE TRABAJO"}</div>
      <nav>{nav.map(item=>{const Icon=item.icon;return <button key={item.id} className={`nav-item ${page===item.id?"active":""}`} onClick={()=>{setPage(item.id);setMobileOpen(false);}}>
        <Icon size={18}/><span>{t(item.key)}</span>{item.id==="connections"&&<i className={twitchConnected&&youtubeConnected?"nav-dot online":"nav-dot"}/>}
      </button>;})}</nav>
      <div className="sidebar-bottom">
        <div className="privacy-mini"><ShieldCheck size={17}/><span>{t("safe")}</span></div>
        <button className="language-switch" onClick={()=>setLocale(locale==="en"?"es":"en")}><Languages size={17}/><span>{locale==="en"?"English":"Español"}</span><ChevronDown size={14}/></button>
        <div className="version">VERSION 0.1.0 · LOCAL WORKSPACE</div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-btn" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button>
        <div className="breadcrumbs"><span>STREAM CLIP MAKER</span><b>/</b>{pageTitle}</div>
        <div className="top-actions">
          <span className="local-pill"><span/> {t("local")}</span>
          <button className="avatar" onClick={()=>setPage("settings")}>SC</button>
        </div>
      </header>
      <div className="page-wrap">
        {page==="home"&&<section className="page">
          <div className="hero">
            <div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> {headerHint}</div>
              <h1>{t("greeting")}</h1><p>{t("sub")}</p>
              <div className="hero-actions"><button className="btn btn-primary" onClick={()=>setPage("discover")}><Search size={17}/>{t("discoverNow")}<ArrowRight size={16}/></button><button className="btn btn-quiet" onClick={()=>setPage("create")}><Clapperboard size={17}/>{t("createNow")}</button></div>
            </div>
            <div className="hero-art"><div className="art-glow"/><div className="phone-frame"><div className="phone-top"/><div className="phone-scene"><div className="scene-sun"/><div className="scene-hill hill-a"/><div className="scene-hill hill-b"/><div className="scene-caption">THAT WAS INSANE!</div></div><div className="phone-controls"><span/><span/><span/></div></div><div className="floating-tag"><Zap size={14}/> HIGHLIGHT FOUND</div></div>
          </div>
          <div className="section-head"><div><h2>{t("quick")}</h2><p>{locale==="en"?"Pick up where the action starts.":"Empieza por donde quieras."}</p></div></div>
          <div className="quick-grid">
            <button className="quick-card" onClick={()=>setPage("discover")}><div className="quick-icon purple"><Search/></div><div><strong>{t("discoverNow")}</strong><span>{locale==="en"?"Explore live streams and VODs":"Explora directos y VODs"}</span></div><ArrowRight/></button>
            <button className="quick-card" onClick={()=>setPage("create")}><div className="quick-icon orange"><ScissorsIcon/></div><div><strong>{t("createNow")}</strong><span>{locale==="en"?"Find the best chat reactions":"Encuentra las mejores reacciones"}</span></div><ArrowRight/></button>
            <button className="quick-card" onClick={()=>setPage("connections")}><div className="quick-icon green"><Globe2/></div><div><strong>{t("setup")}</strong><span>{locale==="en"?"Connect Twitch and YouTube":"Conecta Twitch y YouTube"}</span></div><ArrowRight/></button>
          </div>
          <div className="section-head"><div><h2>{t("status")}</h2><p>{locale==="en"?"Your tools and integrations at a glance.":"Tus herramientas e integraciones."}</p></div></div>
          <div className="status-grid">
            <div className="status-card"><div className="status-top"><span className="status-icon twitch-icon">T</span><span className={twitchConnected?"status-good":"status-muted"}>{twitchConnected?t("connected"):t("notConnected")}</span></div><strong>Twitch</strong><small>{locale==="en"?"Stream discovery":"Búsqueda de directos"}</small></div>
            <div className="status-card"><div className="status-top"><span className="status-icon youtube-icon">▶</span><span className={youtubeConnected?"status-good":"status-muted"}>{youtubeConnected?t("connected"):t("notConnected")}</span></div><strong>YouTube</strong><small>{locale==="en"?"Private video uploads":"Subidas privadas de vídeos"}</small></div>
            <div className="status-card"><div className="status-top"><span className="status-icon ff-icon"><Activity size={17}/></span><span className="status-good">{t("ready")}</span></div><strong>FFmpeg</strong><small>{locale==="en"?"Video processing engine":"Motor de procesamiento"}</small></div>
          </div>
          <div className="privacy-banner"><ShieldCheck size={20}/><div><strong>{locale==="en"?"Your content stays yours":"Tu contenido sigue siendo tuyo"}</strong><span>{t("privacy")}</span></div></div>
        </section>}

        {page==="discover"&&<section className="page">
          <PageHeading icon={<Search/>} title={t("discoverTitle")} subtitle={t("discoverSub")}/>
          <div className="panel search-panel"><label>{t("topic")}</label><div className="search-row"><input value={topic} onChange={e=>setTopic(e.target.value)} placeholder={t("searchPlaceholder")} onKeyDown={e=>e.key==="Enter"&&doSearch()}/><button className="btn btn-primary" onClick={doSearch} disabled={busy||!topic.trim()}><Search size={17}/>{t("search")}</button></div><p className="field-hint"><ShieldCheck size={14}/>{locale==="en"?"Search results are discovery only. Always confirm reuse permission with the creator.":"Los resultados son solo descubrimiento. Confirma siempre los permisos con el creador."}</p></div>
          <div className="section-head"><h2>{t("results")}</h2>{searchResults&&<span className="result-count">{searchResults.totalLiveMatches||0} live · {searchResults.totalVods||0} VODs</span>}</div>
          {!searchResults?<div className="empty-state"><div className="empty-icon"><Search size={25}/></div><strong>{t("noResults")}</strong><span>{locale==="en"?"Your search results will appear here.":"Los resultados aparecerán aquí."}</span></div>:<><div className="results-list">{(searchResults.streams||[]).slice(0,12).map((s:any)=><div className="result-row" key={s.streamId}><div className="live-thumb"><Video/></div><div className="result-info"><strong>{s.displayName}</strong><span>{s.title}</span><small>{s.category} · {s.language}</small></div><div className="result-viewers">{s.viewers?.toLocaleString()} <small>{locale==="en"?"viewers":"espectadores"}</small></div><span className={s.authorized?"permission-ok":"permission-no"}>{s.authorized?"Allowed":"Check rights"}</span></div>)}</div><div className="section-head"><h2>{locale==="en"?"Archived VODs":"VODs archivados"}</h2></div><div className="results-list">{(searchResults.vods||[]).slice(0,12).map((v:any)=><div className="result-row" key={v.vodId}><div className="live-thumb"><Play/></div><div className="result-info"><strong>{v.channel}</strong><span>{v.title}</span><small>{v.category} · {v.duration} · {v.language}</small></div><div className="result-viewers">{v.views?.toLocaleString()} <small>{locale==="en"?"views":"visualizaciones"}</small></div><span className={v.authorized?"permission-ok":"permission-no"}>{v.authorized?"Allowed":"Check rights"}</span></div>)}</div></>}
        </section>}

        {page==="live"&&<section className="page">
          <PageHeading icon={<Activity/>} title={t("liveTitle")} subtitle={t("liveSub")}/>
          <div className="panel form-panel narrow">
            <Field label={t("liveChannels")} value={liveChannels} onChange={setLiveChannels} placeholder="channel_one, channel_two"/>
            <label className="check-line rights-check">
              <input type="checkbox" checked={liveRights} onChange={e=>setLiveRights(e.target.checked)}/>
              <span>{t("liveRights")}</span>
            </label>
            <div className="notice-card"><ShieldCheck size={18}/><span>{t("liveHint")}</span></div>
            <button className="btn btn-outline full-btn" disabled={!liveRights || busy || !!liveTaskId} onClick={saveLiveAllowlist}>{t("saveAllowlist")}</button>
            <div className="two-col">
              <button className="btn btn-outline" disabled={!liveRights || busy || !!liveTaskId || !liveChannels.trim()} onClick={()=>startLiveCapture(true)}>{t("startChatOnly")}</button>
              <button className="btn btn-primary" disabled={!liveRights || busy || !!liveTaskId || !liveChannels.trim()} onClick={()=>startLiveCapture(false)}><Play size={16}/>{t("startCapture")}</button>
            </div>
            <button className="btn btn-outline full-btn" disabled={!liveTaskId} onClick={stopLiveCapture}><X size={16}/>{t("stopCapture")}</button>
            {liveTaskId&&<div className="notice-card"><Activity size={18}/><span>{t("liveRunning")} · #{liveTaskId}</span></div>}
          </div>
        </section>}

        {page==="create"&&<section className="page">
          <PageHeading icon={<Clapperboard/>} title={t("createTitle")} subtitle={t("createSub")}/>
          <div className="panel form-panel">
            <div className="panel-title"><span className="step-num">01</span><div><h2>{locale==="en"?"Choose your chat replay":"Elige la repetición del chat"}</h2><p>{locale==="en"?"The chat helps identify the moments that matter.":"El chat ayuda a identificar los momentos importantes."}</p></div></div>
            <label>{t("chatFile")}</label><div className="file-field"><span><MessageCircle size={17}/>{chat?chat.split(/[\\/]/).pop():locale==="en"?"No file selected":"Ningún archivo seleccionado"}</span><button className="btn btn-outline" onClick={async()=>{const f=await pickFile([{name:"Chat replay",extensions:["json","jsonl"]}]);if(f)setChat(f);}}><FolderOpen size={16}/>{t("chooseFile")}</button></div>
            <div className="panel-title spaced"><span className="step-num">02</span><div><h2>{locale==="en"?"Choose your video source":"Elige el vídeo de origen"}</h2><p>{locale==="en"?"Select where the footage comes from.":"Selecciona de dónde viene el vídeo."}</p></div></div>
            <div className="source-grid">{[{v:"analysis",label:t("analysisOnly"),sub:locale==="en"?"Find moments without rendering":"Encontrar momentos sin renderizar",icon:<MessageCircle/>},{v:"twitch",label:t("twitchVod"),sub:locale==="en"?"Clip an archived Twitch stream":"Crear clips de un VOD",icon:<Video/>},{v:"youtube",label:t("videoUrl"),sub:locale==="en"?"Use a supported video URL":"Usar una URL compatible",icon:<Globe2/>},{v:"local",label:t("localVideo"),sub:locale==="en"?"Use a file on your device":"Usar un archivo local",icon:<FileVideo/>}].map(o=><button key={o.v} className={`source-option ${source===o.v?"selected":""}`} onClick={()=>setSource(o.v)}><span className="source-icon">{o.icon}</span><span><strong>{o.label}</strong><small>{o.sub}</small></span>{source===o.v&&<Check size={16}/>}</button>)}</div>
            {source==="twitch"&&<Field label={t("vodId")} value={vod} onChange={setVod} placeholder="1234567890"/>}
            {source==="youtube"&&<Field label={t("url")} value={url} onChange={setUrl} placeholder="https://www.youtube.com/watch?v=…"/>}
            {source==="local"&&<div className="field"><label>{t("localVideo")}</label><div className="file-field"><span>{video||"MP4, MKV, MOV…"}</span><button className="btn btn-outline" onClick={async()=>{const f=await pickFile([{name:"Video",extensions:["mp4","mkv","mov","webm"]}]);if(f)setVideo(f);}}>{t("chooseFile")}</button></div></div>}
            <div className="two-col"><Field label={t("top")} value={top} onChange={setTop} type="number"/><Field label={t("output")} value={output} onChange={setOutput}/></div>
            <label className="check-line"><input type="checkbox" checked={vertical} onChange={e=>setVertical(e.target.checked)}/><span>{t("vertical")}</span></label>
            {source!=="analysis"&&<label className="check-line rights-check"><input type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)}/><span>{t("permission")}</span></label>}
            <div className="form-footer"><span><ShieldCheck size={15}/>{t("safe")}</span><button className="btn btn-primary" onClick={doCreate} disabled={busy||!chat||source==="twitch"&&!vod||source==="youtube"&&!url||source==="local"&&!video}><Play size={16}/>{source==="analysis"?t("analyze"):t("render")}</button></div>
          </div>
        </section>}

        {page==="enhance"&&<section className="page">
          <PageHeading icon={<Subtitles/>} title={t("enhanceTitle")} subtitle={t("enhanceSub")}/>
          <div className="panel form-panel narrow"><label>{t("inputVideo")}</label><div className="file-field"><span>{enhanceInput||"Choose a vertical MP4 file"}</span><button className="btn btn-outline" onClick={async()=>{const f=await pickFile([{name:"MP4 video",extensions:["mp4"]}]);if(f)setEnhanceInput(f);}}><FolderOpen size={16}/>{t("chooseFile")}</button></div><Field label={t("overlayTitle")} value={clipTitle} onChange={setClipTitle}/><div className="notice-card"><Sparkles size={18}/><span>{locale==="en"?"Requires FFmpeg and Whisper.cpp with a multilingual model installed. The final video is saved next to the source file.":"Requiere FFmpeg y Whisper.cpp con un modelo multilingüe. El vídeo final se guarda junto al original."}</span></div><button className="btn btn-primary full-btn" disabled={busy||!enhanceInput} onClick={doEnhance}><Subtitles size={17}/>{t("enhanceAction")}</button></div>
        </section>}

        {page==="share"&&<section className="page">
          <PageHeading icon={<Share2/>} title={t("shareTitle")} subtitle={t("shareSub")}/>
          <div className="panel form-panel narrow"><label>{t("finalVideo")}</label><div className="file-field"><span>{shareInput||"Select a file ending in _final.mp4"}</span><button className="btn btn-outline" onClick={async()=>{const f=await pickFile([{name:"Finished video",extensions:["mp4"]}]);if(f)setShareInput(f);}}><FolderOpen size={16}/>{t("chooseFile")}</button></div><Field label={t("videoTitle")} value={shareTitle} onChange={setShareTitle} placeholder="My highlight #Shorts"/><div className="field"><label>{t("description")}</label><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></div><Field label={t("tags")} value={tags} onChange={setTags} placeholder="gaming, highlights, shorts"/><label className="check-line rights-check"><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/><span>{t("rights")}</span></label><div className="notice-card"><ShieldCheck size={18}/><span>{locale==="en"?"Uploads are always private. Review the video in YouTube Studio before making it public.":"Las subidas siempre son privadas. Revisa el vídeo en YouTube Studio antes de hacerlo público."}</span></div><button className="btn btn-primary full-btn" disabled={busy||!shareInput||!rights||!youtubeConnected&&isTauri()} onClick={doUpload}><Upload size={17}/>{t("uploadPrivate")}</button></div>
        </section>}

        {page==="connections"&&<section className="page">
          <PageHeading icon={<Globe2/>} title={t("connectionsTitle")} subtitle={t("connectionsSub")}/>
          <div className="connection-grid">
            <div className="panel connection-card"><div className="connection-brand"><span className="status-icon twitch-icon">T</span><div><h2>Twitch</h2><p>{locale==="en"?"Find live streams and archived VODs.":"Encuentra directos y VODs."}</p></div><span className={twitchConnected?"status-good":"status-muted"}>{twitchConnected?t("connected"):t("notConnected")}</span></div><Field label={t("twitchClient")} value={clientId} onChange={setClientId} placeholder="Client ID"/><Field label={t("twitchSecret")} value={clientSecret} onChange={setClientSecret} type="password" placeholder="Client Secret"/><button className="btn btn-primary full-btn" disabled={!clientId||!clientSecret} onClick={saveTwitch}>{t("saveTwitch")}</button><small className="muted">{locale==="en"?"Create an app at dev.twitch.tv/console/apps. Secrets are stored in your local app data folder.":"Crea una aplicación en dev.twitch.tv/console/apps. Las claves se guardan en los datos locales de la app."}</small></div>
            <div className="panel connection-card"><div className="connection-brand"><span className="status-icon youtube-icon">▶</span><div><h2>YouTube</h2><p>{locale==="en"?"Upload finished videos privately.":"Sube vídeos terminados en privado."}</p></div><span className={youtubeConnected?"status-good":"status-muted"}>{youtubeConnected?t("connected"):t("notConnected")}</span></div><div className="notice-card">{t("youtubeNote")}</div><button className="btn btn-primary full-btn" onClick={connectYoutube}><FolderOpen size={16}/>{t("connectYoutube")}</button><small className="muted">{locale==="en"?"OAuth client JSON and refresh token are kept on this device.":"El JSON OAuth y el token se guardan en este dispositivo."}</small></div>
          </div>
        </section>}

        {page==="settings"&&<section className="page">
          <PageHeading icon={<Settings/>} title={t("settingsTitle")} subtitle={locale==="en"?"Make Stream Clip Maker feel right for you.":"Configura Stream Clip Maker a tu gusto."}/>
          <div className="panel settings-panel"><div><h2>{t("language")}</h2><p>{locale==="en"?"Choose the language used across the app.":"Elige el idioma de toda la aplicación."}</p></div><div className="language-options"><button className={locale==="en"?"language-card chosen":"language-card"} onClick={()=>setLocale("en")}><span>🇬🇧</span><strong>{t("english")}</strong>{locale==="en"&&<Check size={16}/>}</button><button className={locale==="es"?"language-card chosen":"language-card"} onClick={()=>setLocale("es")}><span>🇪🇸</span><strong>{t("spanish")}</strong>{locale==="es"&&<Check size={16}/>}</button></div></div>
        </section>}

        {page==="help"&&<section className="page">
          <PageHeading icon={<CircleHelp/>} title={t("helpTitle")} subtitle={t("helpSub")}/>
          <div className="guide-list">{[1,2,3,4,5,6].map(n=><div className="panel guide-card" key={n}><div className="guide-number">0{n}</div><div><h3>{t((`guide${n}`) as keyof typeof copy.en)}</h3><p>{t((`guide${n}Text`) as keyof typeof copy.en)}</p></div><ArrowRight size={17}/></div>)}</div>
        </section>}

        {notice&&<div className="toast" role="status"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={15}/></button></div>}
        <section className="activity-panel"><div className="activity-head"><div><Activity size={16}/><strong>{t("logs")}</strong></div><span>{busy?<><LoaderCircle className="spin" size={14}/>{t("processing")}</>:t("waiting")}</span></div><div className="activity-lines">{logs.length?logs.slice(-5).map((line,i)=><p key={i}>{line}</p>):<p className="muted-line">{locale==="en"?"Your recent actions and processing messages will appear here.":"Tus acciones recientes y mensajes aparecerán aquí."}</p>}</div></section>
        <footer className="page-footer"><span>STREAM CLIP MAKER <b>·</b> 0.1.0</span><span><ShieldCheck size={13}/>{t("safe")}</span></footer>
      </div>
    </main>
    {mobileOpen&&<button className="mobile-scrim" onClick={()=>setMobileOpen(false)} aria-label="Close menu"/>}
  </div>;
}

function PageHeading({icon,title,subtitle}:{icon:ReactNode;title:string;subtitle:string}) {
  return <div className="page-heading"><div className="heading-icon">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div></div>;
}
function Field({label,value,onChange,placeholder="",type="text"}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string;type?:string}) {
  return <div className="field"><label>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></div>;
}
function ScissorsIcon(){return <span className="scissors-symbol">✂</span>}
