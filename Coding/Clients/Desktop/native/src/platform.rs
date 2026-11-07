//! Windows-specific desktop parenting is isolated from the application core.
use std::{collections::HashMap, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, OnceLock, Mutex}, time::Duration};
use tauri::{Emitter, Manager};
use windows_sys::Win32::{Foundation::*, UI::{WindowsAndMessaging::*, Accessibility::*}, Graphics::Gdi::*, System::JobObjects::*};
use std::os::windows::io::AsRawHandle;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static OLD_PROC: OnceLock<isize> = OnceLock::new();
static CALENDAR_LOCKED: AtomicBool = AtomicBool::new(false);
static CALENDAR_ENABLED: AtomicBool = AtomicBool::new(false);
static ISLAND_AUTO_HIDDEN: AtomicBool = AtomicBool::new(false);
static SAVE_GENERATION: AtomicU64 = AtomicU64::new(0);
static SAVE_PENDING: AtomicBool = AtomicBool::new(false);
static JOB: OnceLock<usize> = OnceLock::new();
static WINDOW_PREFS: OnceLock<Mutex<HashMap<String, Geometry>>> = OnceLock::new();
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Geometry { x: i32, y: i32, width: u32, height: u32, locked: bool }
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }
fn data_root() -> std::path::PathBuf { std::env::var_os("CTT_DESKTOP_DATA").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("CalendarTaskTimer/Desktop")) }
pub fn diagnostic(key:&str,value:serde_json::Value){if std::env::var("CTT_DESKTOP_OFFLINE").as_deref()!=Ok("1"){return;}let file=data_root().join("native-diagnostics.json");let mut data:serde_json::Value=std::fs::read(&file).ok().and_then(|raw|serde_json::from_slice(&raw).ok()).unwrap_or_else(||serde_json::json!({}));data[key]=value;let _=std::fs::write(file,serde_json::to_vec(&data).unwrap_or_default());}
fn prefs() -> &'static Mutex<HashMap<String, Geometry>> { WINDOW_PREFS.get_or_init(|| Mutex::new(std::fs::read(data_root().join("windows.json")).ok().and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_default())) }
pub fn contain_child(child: &std::process::Child) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null()); if job.is_null() { return Err("无法建立后台进程保护".into()); }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed(); info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32) == 0 || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 { CloseHandle(job); return Err("无法保护后台生命周期，停止启动".into()); }
        let _ = JOB.set(job as usize);
    } Ok(())
}
unsafe extern "system" fn find_icon_host(hwnd: HWND, result: LPARAM) -> BOOL {
    let mut class=[0u16;80];GetClassNameW(hwnd,class.as_mut_ptr(),80);
    if String::from_utf16_lossy(&class).trim_end_matches('\0')=="SHELLDLL_DefView" { *(result as *mut HWND)=GetParent(hwnd);return 0; } 1
}
unsafe extern "system" fn desktop_enum(hwnd: HWND, result: LPARAM) -> BOOL {
    let mut class=[0u16;80];GetClassNameW(hwnd,class.as_mut_ptr(),80);
    let class=String::from_utf16_lossy(&class);let class=class.trim_end_matches('\0');
    if class=="Progman"||class=="WorkerW" { EnumChildWindows(hwnd,Some(find_icon_host),result);if !(*(result as *mut HWND)).is_null(){return 0;} } 1
}
pub fn attach_calendar(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("calendar").ok_or("日历面板尚未创建")?;
    unsafe {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
        let mut desired:RECT=std::mem::zeroed();if GetWindowRect(hwnd,&mut desired)==0{return Err("无法读取面板位置".into());}
        let shell=GetShellWindow();if shell.is_null(){return Err("Windows 桌面不可用；主窗口仍可使用".into());}
        // Interactive widgets sit above icons inside the desktop host, rather
        // than in a wallpaper-only WorkerW. New Windows can nest the icon view.
        let mut worker: HWND = std::ptr::null_mut();EnumChildWindows(shell,Some(find_icon_host),&mut worker as *mut _ as LPARAM);
        if worker.is_null(){EnumWindows(Some(desktop_enum), &mut worker as *mut _ as LPARAM);}
        if worker.is_null() { return Err("未找到可挂载桌面层，日历面板暂不可用".into()); }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE); SetWindowLongPtrW(hwnd, GWL_STYLE, (style & !(WS_POPUP as isize)) | WS_CHILD as isize);
        if GetParent(hwnd)!=worker{SetLastError(0); let prior = SetParent(hwnd, worker);
          if prior.is_null() && GetLastError() != 0 { SetWindowLongPtrW(hwnd, GWL_STYLE, style); let _ = window.hide(); return Err("桌面挂载失败（可能为 DPI 不兼容）；主窗口仍可使用".into()); }}
        let mut point=POINT{x:desired.left,y:desired.top};ScreenToClient(worker,&mut point);
        SetWindowPos(hwnd, HWND_TOP, point.x, point.y, desired.right-desired.left, desired.bottom-desired.top, SWP_NOACTIVATE | SWP_FRAMECHANGED);
        let mut class=[0u16;80];GetClassNameW(worker,class.as_mut_ptr(),80);
        let mut actual:RECT=std::mem::zeroed();GetWindowRect(hwnd,&mut actual);
        diagnostic("desktopCalendar",serde_json::json!({"attached":GetParent(hwnd)==worker,"hostClass":String::from_utf16_lossy(&class).trim_end_matches('\0'),"x":actual.left,"y":actual.top,"width":actual.right-actual.left,"height":actual.bottom-actual.top}));
    } Ok(())
}
pub fn toggle_lock(app: &tauri::AppHandle) -> Result<(), String> {
    let locked = !CALENDAR_LOCKED.load(Ordering::Relaxed); CALENDAR_LOCKED.store(locked, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("calendar") { window.set_resizable(!locked).map_err(|e| e.to_string())?; save_geometry_later(app, "calendar"); }
    app.emit("calendar-lock", locked).map_err(|e| e.to_string())
}
pub fn restore_geometry(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let saved = prefs().lock().unwrap().get(window.label()).cloned();
    let Ok(monitors) = app.available_monitors() else { return; };
    let primary=app.primary_monitor().ok().flatten();let Some(monitor) = primary.as_ref().or_else(||monitors.first()) else { return; };
    let (mut x, mut y, mut width, mut height, locked) = saved.map(|s| (s.x, s.y, s.width, s.height, s.locked)).unwrap_or_else(|| { let size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(370, 650));let x=monitor.position().x+if window.label()=="calendar"{monitor.size().width.saturating_sub(size.width+30) as i32}else{monitor.size().width.saturating_sub(size.width) as i32/2};let y=monitor.position().y+if window.label()=="island"{12}else if window.label()=="main"{monitor.size().height.saturating_sub(size.height) as i32/2}else{30}; (x,y,size.width,size.height,false) });
    let target = monitors.iter().find(|m| x >= m.position().x && y >= m.position().y && x < m.position().x + m.size().width as i32 && y < m.position().y + m.size().height as i32).unwrap_or(monitor);
    width = width.clamp(280, target.size().width.max(280)); height = if window.label() == "island" { (54.0 * target.scale_factor()) as u32 } else { height.clamp(300, target.size().height.max(300)) };
    x = x.clamp(target.position().x, target.position().x + target.size().width.saturating_sub(width) as i32); y = y.clamp(target.position().y, target.position().y + target.size().height.saturating_sub(height) as i32);
    let mut positioned=false;
    if window.label()=="calendar"{unsafe{if let Ok(handle)=window.hwnd(){let hwnd=handle.0 as HWND;if GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_CHILD as isize!=0{let parent=GetParent(hwnd);let mut point=POINT{x,y};ScreenToClient(parent,&mut point);SetWindowPos(hwnd,std::ptr::null_mut(),point.x,point.y,width as i32,height as i32,SWP_NOZORDER|SWP_NOACTIVATE);positioned=true;}}}}
    if !positioned{let _ = window.set_position(tauri::PhysicalPosition::new(x, y)); let _ = window.set_size(tauri::PhysicalSize::new(width, height));}
    if window.label() == "calendar" { CALENDAR_LOCKED.store(locked, Ordering::Relaxed); let _ = window.set_resizable(!locked); }
}
pub fn save_geometry_later(app: &tauri::AppHandle, label: &str) {
    if !["calendar", "island", "main"].contains(&label) { return; }
    if let Some(window) = app.get_webview_window(label) { if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
        prefs().lock().unwrap().insert(label.into(), Geometry { x: position.x, y: position.y, width: if label == "island" { (370.0 * window.scale_factor().unwrap_or(1.0)) as u32 } else { size.width }, height: size.height, locked: label == "calendar" && CALENDAR_LOCKED.load(Ordering::Relaxed) });
    } }
    let generation = SAVE_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    if SAVE_PENDING.swap(true, Ordering::SeqCst) { return; }
    std::thread::spawn(move || {
        let mut observed = generation;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let current = SAVE_GENERATION.load(Ordering::SeqCst);
            if current != observed { observed = current; continue; }
            if let Ok(raw) = serde_json::to_vec(&*prefs().lock().unwrap()) { let root = data_root(); let _ = std::fs::create_dir_all(&root); if std::fs::write(root.join("windows.json.tmp"), raw).is_ok() { let _ = std::fs::rename(root.join("windows.json.tmp"), root.join("windows.json")); } }
            SAVE_PENDING.store(false, Ordering::SeqCst);
            if SAVE_GENERATION.load(Ordering::SeqCst) == observed || SAVE_PENDING.swap(true, Ordering::SeqCst) { break; }
            observed = SAVE_GENERATION.load(Ordering::SeqCst);
        }
    });
}
unsafe extern "system" fn foreground(_hook: HWINEVENTHOOK, event: u32, hwnd: HWND, object: i32, _child: i32, _thread: u32, _time: u32) {
    if event == EVENT_OBJECT_LOCATIONCHANGE && (hwnd != GetForegroundWindow() || object != 0) { return; }
    let Some(app) = APP.get() else { return; }; let Some(island) = app.get_webview_window("island") else { return; };
    let foreground = GetForegroundWindow(); if foreground.is_null() || island.hwnd().map(|h| h.0 as HWND == foreground).unwrap_or(false) { return; }
    let mut rect: RECT = std::mem::zeroed(); GetWindowRect(foreground, &mut rect);
    let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST); let mut info: MONITORINFO = std::mem::zeroed(); info.cbSize = std::mem::size_of::<MONITORINFO>() as u32; GetMonitorInfoW(monitor, &mut info);
    let mut class = [0u16; 80]; GetClassNameW(foreground, class.as_mut_ptr(), 80); let class = String::from_utf16_lossy(&class).trim_end_matches('\0').to_string();
    let fullscreen = !["Progman", "WorkerW", "Shell_TrayWnd"].contains(&class.as_str()) && rect.left <= info.rcMonitor.left && rect.top <= info.rcMonitor.top && rect.right >= info.rcMonitor.right && rect.bottom >= info.rcMonitor.bottom;
    if fullscreen && island.is_visible().unwrap_or(false) { ISLAND_AUTO_HIDDEN.store(true, Ordering::Relaxed); let _ = island.hide(); suspend_webview(&island,true); }
    else if !fullscreen && ISLAND_AUTO_HIDDEN.swap(false, Ordering::Relaxed) { suspend_webview(&island,false);let _ = island.show(); }
}
unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if let Some(app) = APP.get() {
        if message == WM_POWERBROADCAST { if w == 4 { app.state::<crate::Backend>().signal("suspend"); } if w == 18 || w == 7 { app.state::<crate::Backend>().signal("resume"); } }
        if message == WM_TIMECHANGE { app.state::<crate::Backend>().signal("time-change"); }
        let taskbar_created = RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
        if message == taskbar_created || message == WM_DISPLAYCHANGE {
            let handle = app.clone(); std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(600));if let Some(window)=handle.get_webview_window("island"){restore_geometry(&handle,&window);}if CALENDAR_ENABLED.load(Ordering::Relaxed){if let Some(window)=handle.get_webview_window("calendar"){restore_geometry(&handle,&window);}let mut last=None;for delay in [0,500,1000]{if delay>0{std::thread::sleep(Duration::from_millis(delay));}match crate::open_window(&handle,"calendar"){Ok(())=>{last=None;break},Err(error)=>last=Some(error)}}if let Some(error)=last{let _=handle.emit("native-error",error);}} });
        }
    }
    match OLD_PROC.get() { Some(proc) => CallWindowProcW(Some(std::mem::transmute::<isize, unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>(*proc)), hwnd, message, w, l), None => DefWindowProcW(hwnd, message, w, l) }
}
pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    APP.set(app.clone()).map_err(|_| "原生适配重复初始化")?;
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    restore_geometry(app, &window);
    unsafe {
        let hwnd = window.hwnd()?.0 as HWND;
        let prior = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wndproc as *const () as isize); if prior == 0 { return Err("无法监听 Windows 生命周期".into()); } let _ = OLD_PROC.set(prior);
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, std::ptr::null_mut(), Some(foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
        SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, std::ptr::null_mut(), Some(foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
    } Ok(())
}
pub fn calendar_locked() -> bool { CALENDAR_LOCKED.load(Ordering::Relaxed) }
pub fn calendar_enabled(enabled:bool){CALENDAR_ENABLED.store(enabled,Ordering::Relaxed);}
/// Suspend only hidden UI renderers. Node remains the timer and sync authority.
pub fn suspend_webview(window:&tauri::WebviewWindow,suspended:bool){
    use windows_core::Interface;
    use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2_3,TrySuspendCompletedHandler};
    let _=window.with_webview(move|view|unsafe{
        if let Ok(core)=view.controller().CoreWebView2(){if let Ok(core)=core.cast::<ICoreWebView2_3>(){
            if suspended{let callback=TrySuspendCompletedHandler::create(Box::new(|_,_|Ok(())));let _=core.TrySuspend(&callback);}
            else{let _=core.Resume();}
        }}
    });
}
