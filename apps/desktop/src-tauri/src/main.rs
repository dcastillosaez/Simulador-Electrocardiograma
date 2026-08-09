// El shell de escritorio del simulador.
//
// Su trabajo es sostener la ventana, arrancar el backend y pararlo. Nada más:
// la lógica clínica vive en el motor y la de simulación en FastAPI. Si algún
// día hay que tocar este fichero para cambiar cómo se simula, algo se ha
// colocado en el sitio equivocado.

// Sin consola en release: una ventana de terminal detrás de la aplicación es
// exactamente lo que la fase G existe para que el usuario no vea.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
#[cfg(windows)]
mod job;

use backend::{localizar_backend, BackendHandle};
use tauri::{Manager, RunEvent, WindowEvent};

/// Dónde escucha el backend. La interfaz lo pregunta al arrancar, antes de
/// crear el `SessionRuntime`: el puerto es efímero y no se conoce hasta que el
/// proceso lo anuncia.
#[tauri::command]
fn get_backend_url(state: tauri::State<BackendHandle>) -> String {
    state.base_url()
}

/// El secreto de esta sesión. La interfaz lo presenta en cada petición y en el
/// handshake del WebSocket; sin él, el backend —que escucha en 127.0.0.1, al
/// alcance de cualquier programa del equipo— no atiende.
#[tauri::command]
fn get_backend_token(state: tauri::State<BackendHandle>) -> String {
    state.token()
}

/// Estado del arranque, para que el splash cuente algo cierto en vez de una
/// barra que sube sola.
#[tauri::command]
fn get_startup_status(state: tauri::State<BackendHandle>) -> serde_json::Value {
    serde_json::json!({
        "backend": state.status(),
        "baseUrl": state.base_url(),
    })
}

/// Arranca el backend empaquetado, o cae al de desarrollo si no lo encuentra.
///
/// Caer al de desarrollo es deliberado: permite trabajar en la ventana nativa
/// contra el `arrancar.bat` de siempre, sin reempaquetar Python en cada cambio
/// del frontend.
fn preparar_backend(app: &tauri::App) -> BackendHandle {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let data_dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("SimuladorECG"));

    match exe_dir.as_deref().and_then(localizar_backend) {
        Some(exe) => match BackendHandle::spawn(&exe, &data_dir) {
            Ok(handle) => handle,
            Err(e) => {
                eprintln!("no se pudo arrancar el backend empaquetado: {e}");
                BackendHandle::development()
            }
        },
        None => {
            eprintln!("backend empaquetado no encontrado: se usa el de desarrollo");
            BackendHandle::development()
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = preparar_backend(app);
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_backend_token,
            get_startup_status
        ])
        .on_window_event(|window, event| {
            // Cerrar la ventana apaga el backend ANTES de que el proceso
            // termine. El job object lo mataría igualmente, pero eso es la red
            // de seguridad: hacerlo aquí libera el puerto y la memoria de
            // inmediato, y deja el apagado en un sitio donde se puede leer.
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                window.state::<BackendHandle>().shutdown();
            }
        })
        .build(tauri::generate_context!())
        .expect("no se pudo construir la aplicación")
        .run(|app, event| {
            // Y también cuando la aplicación termina por cualquier otra vía
            // que sí pase por el bucle de eventos. `shutdown` es idempotente.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app.state::<BackendHandle>().shutdown();
            }
        });
}
