use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

static NEXT_TASK: AtomicU64 = AtomicU64::new(1);
static EXITING: AtomicBool = AtomicBool::new(false);

struct TaskControl {
    stop: Arc<AtomicBool>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
}

static TASKS: OnceLock<Mutex<HashMap<String, TaskControl>>> = OnceLock::new();

#[cfg(unix)]
fn terminate_child(child: &mut Child, graceful: bool) {
    let pid = child.id() as libc::pid_t;
    let target = if graceful { pid } else { -pid };
    unsafe {
        libc::kill(target, libc::SIGTERM);
    }
}

#[cfg(windows)]
fn terminate_child(child: &mut Child, _graceful: bool) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_child(child: &mut Child, _graceful: bool) {
    let _ = child.kill();
}

#[cfg(unix)]
fn force_kill_child(child: &mut Child) {
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
}

#[cfg(windows)]
fn force_kill_child(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(any(unix, windows)))]
fn force_kill_child(child: &mut Child) {
    let _ = child.kill();
}

fn task_registry() -> &'static Mutex<HashMap<String, TaskControl>> {
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskOutput {
    task_id: String,
    stream: String,
    line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskFinished {
    task_id: String,
    success: bool,
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionStatus {
    twitch_connected: bool,
    youtube_connected: bool,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn engine_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("engine");
        if bundled.is_dir() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn node_binary(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        let bundled = resources.join("runtime").join(name);
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

fn read_env_file(path: &Path) -> Vec<(String, String)> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, raw) = line.split_once('=')?;
            let value = raw.trim().trim_matches('"').trim_matches('\'').to_string();
            Some((key.trim().to_string(), value))
        })
        .collect()
}

#[tauri::command]
fn connection_status(app: AppHandle) -> Result<ConnectionStatus, String> {
    let data = app_data(&app)?;
    let env = read_env_file(&data.join(".env"));
    let twitch_connected = env
        .iter()
        .any(|(k, v)| k == "TWITCH_CLIENT_ID" && !v.is_empty())
        && env
            .iter()
            .any(|(k, v)| k == "TWITCH_CLIENT_SECRET" && !v.is_empty());
    Ok(ConnectionStatus {
        twitch_connected,
        youtube_connected: data.join("youtube-token.json").is_file(),
    })
}

#[tauri::command]
fn save_twitch_credentials(
    app: AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    if client_id.trim().is_empty()
        || client_secret.trim().is_empty()
        || client_id.chars().any(|c| matches!(c, '\n' | '\r' | '='))
        || client_secret.chars().any(|c| matches!(c, '\n' | '\r'))
    {
        return Err("Enter a valid Twitch Client ID and Client Secret.".into());
    }
    let data = app_data(&app)?;
    let path = data.join(".env");
    let mut existing = read_env_file(&path);
    existing.retain(|(key, _)| key != "TWITCH_CLIENT_ID" && key != "TWITCH_CLIENT_SECRET");
    existing.push(("TWITCH_CLIENT_ID".into(), client_id.trim().into()));
    existing.push(("TWITCH_CLIENT_SECRET".into(), client_secret.trim().into()));
    let body = existing
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(&path, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn import_youtube_credentials(app: AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(path);
    let raw = fs::read_to_string(&source).map_err(|e| format!("Could not read OAuth JSON: {e}"))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid OAuth JSON: {e}"))?;
    if value.get("installed").is_none() {
        return Err("Choose a Google OAuth Desktop app JSON file (installed client).".into());
    }
    let data = app_data(&app)?;
    let destination = data.join("client_secrets.json");
    fs::write(&destination, raw).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn read_discovery(app: AppHandle) -> Result<Value, String> {
    let path = app_data(&app)?.join("discovery.json");
    if !path.is_file() {
        return Ok(json!({"streams": [], "vods": [], "totalLiveMatches": 0, "totalVods": 0}));
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn live_rules_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app_data(app)?;
    let destination = data.join("rules.json");
    if !destination.is_file() {
        let source = engine_dir(app).join("rules.json");
        if !source.is_file() {
            return Err("The bundled live clipping rules.json file is missing.".into());
        }
        fs::copy(source, &destination).map_err(|e| e.to_string())?;
    }
    Ok(destination)
}

fn normalize_live_channels(channels: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for raw in channels {
        let channel = raw.trim().to_ascii_lowercase();
        if channel.is_empty() {
            continue;
        }
        if channel.len() > 25
            || !channel
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err(format!("Invalid Twitch channel login: {raw}"));
        }
        if seen.insert(channel.clone()) {
            normalized.push(channel);
        }
    }
    Ok(normalized)
}

#[tauri::command]
fn read_live_allowlist(app: AppHandle) -> Result<Vec<String>, String> {
    let path = live_rules_path(&app)?;
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let channels = value
        .get("allowedCreators")
        .and_then(Value::as_array)
        .ok_or_else(|| "rules.json must contain an allowedCreators array.".to_string())?;
    Ok(channels
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect())
}

#[tauri::command]
fn save_live_allowlist(
    app: AppHandle,
    channels: Vec<String>,
    rights_confirmed: bool,
) -> Result<Vec<String>, String> {
    if !rights_confirmed {
        return Err("Confirm that you have permission to capture and clip these channels.".into());
    }
    let channels = normalize_live_channels(channels)?;
    let path = live_rules_path(&app)?;
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "rules.json must contain a JSON object.".to_string())?;
    object.insert("allowedCreators".into(), json!(channels));
    fs::write(
        &path,
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(channels)
}

#[tauri::command]
fn start_engine_task(app: AppHandle, script: String, args: Vec<String>) -> Result<String, String> {
    let allowed = [
        "chat-clips.mjs",
        "discover-twitch.mjs",
        "desktop-engine.mjs",
        "youtube-auth.mjs",
        "youtube-upload.mjs",
        "live-clips.mjs",
    ];
    if !allowed.contains(&script.as_str()) {
        return Err("This engine action is not available.".into());
    }
    let engine = engine_dir(&app);
    let script_path = engine.join(&script);
    if !script_path.is_file() {
        return Err(format!("The bundled engine file is missing: {script}"));
    }
    let data = app_data(&app)?;
    if script == "live-clips.mjs" {
        let _ = live_rules_path(&app)?;
    }
    let task_id = NEXT_TASK.fetch_add(1, Ordering::Relaxed).to_string();
    let node = node_binary(&app);
    let mut command = Command::new(node);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    command
        .arg(script_path)
        .args(args)
        .current_dir(&data)
        .stdin(if script == "live-clips.mjs" {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("STREAM_CLIP_CONFIG_DIR", &data);
    for (key, value) in read_env_file(&data.join(".env")) {
        command.env(key, value);
    }
    if script == "discover-twitch.mjs" {
        command.env("STREAM_CLIP_DISCOVERY_OUT", data.join("discovery.json"));
    }
    let mut child = command.spawn().map_err(|e| {
        format!("Could not start the video engine: {e}. Install the bundled runtime or Node.js.")
    })?;
    let stdin = if script == "live-clips.mjs" {
        child.stdin.take().map(|pipe| Arc::new(Mutex::new(pipe)))
    } else {
        None
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app_out = app.clone();
    let id_out = task_id.clone();
    let out_thread = thread::spawn(move || {
        if let Some(pipe) = stdout {
            for line in BufReader::new(pipe).lines().flatten() {
                let _ = app_out.emit(
                    "task-output",
                    TaskOutput {
                        task_id: id_out.clone(),
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
        }
    });
    let app_err = app.clone();
    let id_err = task_id.clone();
    let err_thread = thread::spawn(move || {
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().flatten() {
                let _ = app_err.emit(
                    "task-output",
                    TaskOutput {
                        task_id: id_err.clone(),
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        }
    });
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut registry = task_registry().lock().map_err(|e| e.to_string())?;
        registry.insert(
            task_id.clone(),
            TaskControl {
                stop: stop_flag.clone(),
                stdin,
            },
        );
    }
    let app_done = app.clone();
    let id_done = task_id.clone();
    let graceful_shutdown = script == "live-clips.mjs";
    thread::spawn(move || {
        let mut stop_sent = false;
        let mut stop_at: Option<Instant> = None;
        let status = loop {
            if stop_flag.load(Ordering::Relaxed) && !stop_sent {
                terminate_child(&mut child, graceful_shutdown);
                stop_sent = true;
                stop_at = Some(Instant::now());
            }
            if stop_at.is_some_and(|at| at.elapsed() > Duration::from_secs(300)) {
                // Last-resort fallback if a task ignores its graceful shutdown.
                force_kill_child(&mut child);
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(150)),
                Err(_) => {
                    force_kill_child(&mut child);
                    break child.wait().ok();
                }
            }
        };
        let _ = out_thread.join();
        let _ = err_thread.join();
        let code = status.and_then(|s| s.code());
        if let Ok(mut registry) = task_registry().lock() {
            registry.remove(&id_done);
        }
        let _ = app_done.emit(
            "task-finished",
            TaskFinished {
                task_id: id_done,
                success: code == Some(0),
                code,
            },
        );
    });
    Ok(task_id)
}

#[tauri::command]
fn stop_engine_task(task_id: String) -> Result<(), String> {
    let registry = task_registry().lock().map_err(|e| e.to_string())?;
    let control = registry
        .get(&task_id)
        .ok_or_else(|| "No active engine task has that ID.".to_string())?;
    if let Some(stdin) = &control.stdin {
        if let Ok(mut pipe) = stdin.lock() {
            if pipe.write_all(b"stop\n").is_ok() && pipe.flush().is_ok() {
                return Ok(());
            }
        }
    }
    control.stop.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn app_info() -> Value {
    json!({
        "name": "Stream Clip Maker",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "architecture": std::env::consts::ARCH
    })
}

#[cfg(target_os = "linux")]
fn configure_linux_fontconfig() {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("STREAM_CLIP_FONTCONFIG_FILE") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources/fontconfig/fonts.conf"));
            candidates.push(parent.join("../share/stream-clip-maker/fontconfig/fonts.conf"));
            candidates.push(parent.join("../lib/stream-clip-maker/fontconfig/fonts.conf"));
            candidates.push(parent.join("../lib64/stream-clip-maker/fontconfig/fonts.conf"));
            candidates.push(parent.join("../share/Stream Clip Maker/fontconfig/fonts.conf"));
        }
    }
    candidates
        .push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/fontconfig/fonts.conf"));
    if let Some(config) = candidates.into_iter().find(|p| p.is_file()) {
        std::env::set_var("FONTCONFIG_FILE", &config);
        if let Some(parent) = config.parent() {
            std::env::set_var("FONTCONFIG_PATH", parent);
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_fontconfig() {}

pub fn run() {
    // Fontconfig must be configured before WebKitGTK creates its first webview.
    configure_linux_fontconfig();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let has_tasks = if let Ok(mut registry) = task_registry().lock() {
                    for control in registry.values_mut() {
                        let mut requested = false;
                        if let Some(stdin) = &control.stdin {
                            if let Ok(mut pipe) = stdin.lock() {
                                requested =
                                    pipe.write_all(b"stop\n").is_ok() && pipe.flush().is_ok();
                            }
                        }
                        if !requested {
                            control.stop.store(true, Ordering::Relaxed);
                        }
                    }
                    !registry.is_empty()
                } else {
                    false
                };
                if has_tasks {
                    api.prevent_close();
                    if !EXITING.swap(true, Ordering::Relaxed) {
                        let app = window.app_handle().clone();
                        thread::spawn(move || loop {
                            let empty = task_registry()
                                .lock()
                                .map(|registry| registry.is_empty())
                                .unwrap_or(true);
                            if empty {
                                app.exit(0);
                                break;
                            }
                            thread::sleep(Duration::from_millis(250));
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            connection_status,
            save_twitch_credentials,
            import_youtube_credentials,
            read_discovery,
            read_live_allowlist,
            save_live_allowlist,
            start_engine_task,
            stop_engine_task,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stream Clip Maker");
}

#[cfg(test)]
mod live_channel_tests {
    use super::normalize_live_channels;

    #[test]
    fn normalizes_and_deduplicates_allowed_channels() {
        let channels =
            normalize_live_channels(vec![" Alice ".into(), "alice".into(), "creator_2".into()])
                .unwrap();
        assert_eq!(channels, vec!["alice", "creator_2"]);
    }

    #[test]
    fn rejects_unsafe_channel_logins() {
        assert!(normalize_live_channels(vec!["../other".into()]).is_err());
        assert!(normalize_live_channels(vec!["name with spaces".into()]).is_err());
        assert!(normalize_live_channels(vec!["a".repeat(26)]).is_err());
    }
}
