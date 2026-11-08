#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod platform;
use std::{io::{BufRead, BufReader, Write}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::Duration};
use std::os::windows::process::CommandExt;
use tauri::{Emitter, Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
use serde_json::{json, Value};
use std::sync::OnceLock;
static STARTED: OnceLock<std::time::Instant> = OnceLock::new();
#[tauri::command]
fn frontend_ready(label: String) { if label=="main" && std::env::var("CTT_DESKTOP_OFFLINE").as_deref()==Ok("1") { if let Some(start)=STARTED.get(){ platform::diagnostic("mainReadyMs",json!(start.elapsed().as_millis())); } } }

#[derive(Clone)]
struct Endpoint { port: u16, token: String }
#[derive(Clone, Default)]
struct Backend { endpoint: Arc<Mutex<Option<Endpoint>>>, child: Arc<Mutex<Option<Child>>>, error: Arc<Mutex<Option<String>>> }
impl Backend {
    fn signal(&self, action: &str) { if let Some(child) = self.child.lock().unwrap().as_mut() { if let Some(input) = child.stdin.as_mut() { let _ = writeln!(input, "{}", json!({"action":action})); } } }
}
#[tauri::command]
async fn backend(state: tauri::State<'_, Backend>, route: String, body: Option<Value>) -> Result<Value, String> {
    let allowed = ["/v1/state", "/v1/day", "/v1/history", "/v1/record", "/v1/command", "/v1/refresh", "/v1/auth", "/v1/calendar", "/v1/retry", "/v1/metadata-probe", "/v1/migration-preview", "/v1/migration-import"];
    if !allowed.contains(&route.split('?').next().unwrap_or("")) || route.contains('#') { return Err("不允许的本机接口".into()); }
    let mut endpoint = None;
    for _ in 0..600 {
        if let Some(error) = state.error.lock().unwrap().clone() { return Err(error); }
        endpoint = state.endpoint.lock().unwrap().clone();
        if endpoint.is_some() { break; } tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let endpoint = endpoint.ok_or("桌面后台未就绪，请从托盘重新打开或检查安装。")?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(65)).no_proxy().build().map_err(|_| "无法建立本机连接")?;
    let url = format!("http://127.0.0.1:{}{}", endpoint.port, route);
    let request = if let Some(body) = body { client.post(url).json(&body) } else { client.get(url) };
    let response = request.bearer_auth(&endpoint.token).send().await.map_err(|_| "桌面后台连接中断；已保存的请求可以重试。")?;
    let status = response.status(); let data: Value = response.json().await.map_err(|_| "后台响应无效")?;
    if !status.is_success() { return Err(data["error"].as_str().unwrap_or("本机操作失败").into()); }
    Ok(data)
}
fn open_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if label=="calendar"{platform::calendar_enabled(true);}
    if let Some(window) = app.get_webview_window(label) { if label == "calendar" { platform::attach_calendar(app)?; } platform::suspend_webview(&window,false);window.show().map_err(|e| e.to_string())?; if label == "main" { let _ = window.set_focus(); } return Ok(()); }
    let (width, height, title) = if label == "calendar" { (370.0, 650.0, "桌面日历") } else { (370.0, 54.0, "计时灵动岛") };
    let mut builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(format!("index.html?window={label}").into()))
        .title(title).inner_size(width, height).decorations(false).skip_taskbar(true).resizable(label == "calendar").always_on_top(label == "island").transparent(label == "island").visible(false);
    // Tauri documents a 1px white Windows border for shadowed undecorated windows.
    if label=="island"{builder=builder.shadow(false).background_color(tauri::window::Color(0,0,0,0));}
    let window=builder.build().map_err(|e|e.to_string())?;
    platform::restore_geometry(app, &window);
    if label == "calendar" { platform::attach_calendar(app)?; }
    window.show().map_err(|e| e.to_string())?; Ok(())
}
#[tauri::command]
async fn window_action(app: tauri::AppHandle, action: String, label: String) -> Result<(), String> {
    match action.as_str() {
        "main" | "calendar" | "island" => open_window(&app, &action),
        "hide" => {if label=="calendar"{platform::calendar_enabled(false);}let window=app.get_webview_window(&label).ok_or("窗口不存在")?;window.hide().map_err(|e| e.to_string())?;platform::suspend_webview(&window,true);Ok(())},
        "lock" => platform::toggle_lock(&app),
        "move" if label != "calendar" || !platform::calendar_locked() => app.get_webview_window(&label).ok_or("窗口不存在")?.start_dragging().map_err(|e| e.to_string()),
        "expand" | "collapse" if label == "island" => app.get_webview_window("island").ok_or("窗口不存在")?.set_size(tauri::LogicalSize::new(if action == "expand" { 580.0 } else { 370.0 }, 54.0)).map_err(|e| e.to_string()),
        _ => Err("未知窗口动作".into())
    }
}
fn start_backend(app: &tauri::AppHandle, state: Backend) -> Result<(), Box<dyn std::error::Error>> {
    let resources = if let Ok(root) = std::env::var("CTT_DESKTOP_RESOURCES") { std::path::PathBuf::from(root) } else { app.path().resource_dir()?.join("resources") };
    // Tauri may return a verbatim Windows path (\\?\...). Node 24's JS
    // realpath walk can lstat the drive-relative root and fail with EISDIR.
    // Keep the packaged module paths unchanged instead of canonicalizing them.
    let node_options: Vec<String> = serde_json::from_str(include_str!("../node-options.json"))?;
    let mut child = Command::new(resources.join("runtime/node.exe")).args(&node_options).arg(resources.join("backend.cjs")).arg(&resources)
        .creation_flags(0x08000000).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    platform::contain_child(&child)?;
    let stdout = child.stdout.take().ok_or("后台输出不可用")?; let stderr = child.stderr.take().ok_or("后台错误通道不可用")?;
    *state.child.lock().unwrap() = Some(child);
    let handle = app.clone(); let reader_state = state.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(data) = serde_json::from_str::<Value>(&line) {
                if data["event"] == "ready" { if let (Some(port), Some(token)) = (data["port"].as_u64(), data["token"].as_str()) { *reader_state.endpoint.lock().unwrap() = Some(Endpoint { port: port as u16, token: token.into() }); let _ = handle.emit("backend-ready", true); } }
                if data["event"] == "state" { for window in handle.webview_windows().values(){if window.is_visible().unwrap_or(false){let _=window.emit("desktop-state",&data["data"]);}} if let Some(tray)=handle.tray_by_id("timer-tray") { let active=&data["data"]["active"]; let title=active["title"].as_str().unwrap_or("当前没有计时"); let phase=if active.is_null(){"待机"}else if active["runningSince"].is_null(){"暂停"}else{"计时中"};let _=tray.set_tooltip(Some(format!("{} · {}",phase,title.chars().take(60).collect::<String>()))); } }
            }
        }
        *reader_state.endpoint.lock().unwrap() = None;
        let mut error = reader_state.error.lock().unwrap(); if error.is_none() { *error = Some("桌面后台已停止；计时状态已保留，请重新启动应用恢复。".into()); }
        let _ = handle.emit("backend-error", error.clone());
    });
    let error_handle=app.clone();
    std::thread::spawn(move || { let mut messages = String::new(); for line in BufReader::new(stderr).lines().map_while(Result::ok) { if messages.len() < 4096 { messages.push_str(&line); messages.push('\n'); } } if !messages.is_empty() { *state.error.lock().unwrap() = Some(messages.clone());let _=error_handle.emit("backend-error",messages); } });
    Ok(())
}
fn main() {
    let _=STARTED.set(std::time::Instant::now());
    let backend_state = Backend::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { let _ = open_window(app, "main"); }))
        .plugin(tauri_plugin_deep_link::init()).manage(backend_state.clone())
        .invoke_handler(tauri::generate_handler![backend, window_action, frontend_ready])
        .setup(move |app| {
            let open = MenuItem::with_id(app, "main", "打开日历与计时", true, None::<&str>)?;
            let calendar = MenuItem::with_id(app, "calendar", "显示／隐藏桌面日历", true, None::<&str>)?;
            let island = MenuItem::with_id(app, "island", "显示／隐藏灵动岛", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "保存为暂停并退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &calendar, &island, &quit])?;
            let icon = app.default_window_icon().cloned().ok_or("应用图标不可用")?;
            TrayIconBuilder::with_id("timer-tray").icon(icon).tooltip("日历与计时 · 后台运行中").menu(&menu)
                .on_menu_event(|app, event| { let id = event.id().as_ref().to_string(); if id == "quit" { app.exit(0); return; } let handle=app.clone(); std::thread::spawn(move || { if id != "main" { if let Some(window) = handle.get_webview_window(&id) { if window.is_visible().unwrap_or(false) { if id=="calendar"{platform::calendar_enabled(false);}let _ = window.hide();platform::suspend_webview(&window,true);return; } } } let _ = open_window(&handle, &id).map_err(|error| handle.emit("native-error", error)); }); }).build(app)?;
            platform::install(app.handle())?;
            start_backend(app.handle(), backend_state.clone())?;
            if std::env::var("CTT_DESKTOP_OFFLINE").as_deref()==Ok("1") && std::env::var("CTT_TEST_ALL_WINDOWS").as_deref()==Ok("1") {
                let handle=app.handle().clone();std::thread::spawn(move||{for label in ["calendar","island"]{if let Err(error)=open_window(&handle,label){platform::diagnostic(label,json!({"error":error}));}}});
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close();if window.label()=="calendar"{platform::calendar_enabled(false);}let _ = window.hide();if let Some(view)=window.app_handle().get_webview_window(window.label()){platform::suspend_webview(&view,true);} },
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => platform::save_geometry_later(window.app_handle(), window.label()),
            tauri::WindowEvent::ScaleFactorChanged { .. } => { platform::save_geometry_later(window.app_handle(),window.label());if window.label()=="calendar"{let _=platform::attach_calendar(window.app_handle()).map_err(|error|window.app_handle().emit("native-error",error));} },
            _ => {}
        }).build(tauri::generate_context!()).expect("无法启动日历与计时");
    app.run(|app, event| { if let tauri::RunEvent::ExitRequested { api, .. } = event {
        let state = app.state::<Backend>();
        if state.child.lock().unwrap().is_some() {
            api.prevent_exit(); state.signal("shutdown");
            let state = state.inner().clone(); let handle = app.clone();
            std::thread::spawn(move || { for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); let mut guard = state.child.lock().unwrap(); if let Some(child) = guard.as_mut() { match child.try_wait() { Ok(Some(status)) => { guard.take();drop(guard);handle.exit(status.code().unwrap_or(1));return; }, _ => {} } } else { return; } } let _ = handle.emit("native-error", "后台尚未确认退出，继续保留应用以防丢失记录。"); });
        }
    } });
}
