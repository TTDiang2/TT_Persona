//! TT_Persona 桌面外壳。
//!
//! 窗口里装的是 `app/web/dist` 那套页面，接口指向本机 8791。
//! 启动时先探一下端口：后端已经在跑就直接用，没跑就按配置拉起来。

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const PORT: u16 = 8791;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn backend_up() -> bool {
    match format!("127.0.0.1:{PORT}").parse() {
        Ok(addr) => TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok(),
        Err(_) => false,
    }
}

/// %APPDATA%\TT_Persona\backend.json —— 用户可以改这里的 Python 和脚本路径
fn config_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("TT_Persona").join("backend.json")
}

fn read_backend() -> (String, String) {
    let mut python = String::from(r"D:\AI\LLM\venv\Scripts\python.exe");
    let mut server = String::from(r"D:\TT_Persona\app\server.py");

    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(txt) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(x) = v.get("python").and_then(|x| x.as_str()) {
                    python = x.to_string();
                }
                if let Some(x) = v.get("server").and_then(|x| x.as_str()) {
                    server = x.to_string();
                }
            }
        }
        Err(_) => {
            // 首次运行：写一份默认配置，方便用户按自己的路径改
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let body = format!(
                "{{\n  \"python\": \"{}\",\n  \"server\": \"{}\"\n}}\n",
                python.replace('\\', "\\\\"),
                server.replace('\\', "\\\\")
            );
            let _ = std::fs::write(&path, body);
        }
    }
    (python, server)
}

fn spawn_backend() {
    let (python, server) = read_backend();
    let mut cmd = Command::new(&python);
    cmd.arg(&server)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(dir) = PathBuf::from(&server).parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(child) => eprintln!("[tt] backend started, pid={}", child.id()),
        Err(e) => eprintln!("[tt] backend failed to start: {e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if backend_up() {
        eprintln!("[tt] backend already listening on {PORT}");
    } else {
        spawn_backend();
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
