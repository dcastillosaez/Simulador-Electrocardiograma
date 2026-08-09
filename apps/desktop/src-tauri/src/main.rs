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
mod license;
mod updates;

use std::path::PathBuf;

use backend::{localizar_backend, BackendHandle};
use tauri::{Manager, RunEvent, WindowEvent};

/// La versión que se está ejecutando. Sale del `Cargo.toml`, que a su vez la
/// comparte con `tauri.conf.json`: una sola fuente.
const VERSION: &str = env!("CARGO_PKG_VERSION");

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

/// Estado de la licencia, para que la interfaz pueda decir de qué edición se
/// trata y avisar cuando esté a punto de caducar.
#[tauri::command]
fn get_license_status(app: tauri::AppHandle) -> license::LicenseStatus {
    let ruta = directorio_datos(&app).join("license.dat");
    license::evaluate(&ruta, &hoy())
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

/// La fecha de hoy en `YYYY-MM-DD`, sin arrastrar una librería de fechas por
/// una resta: la licencia solo necesita comparar días.
fn hoy() -> String {
    let segundos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let dias = segundos / 86_400;

    // Algoritmo civil-from-days de Howard Hinnant, con la era desplazada al
    // 1 de marzo del año 0 para que el bisiesto caiga al final del ciclo.
    let z = dias + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

fn directorio_datos(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("SimuladorECG"))
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
            let datos = directorio_datos(&app.handle().clone());

            // Se marca el intento ANTES de nada: lo que hay que detectar es
            // justamente que el arranque no llegue a completarse.
            updates::marcar_intento(&datos, VERSION);
            if !updates::deberia_actualizar(&datos, VERSION) {
                eprintln!(
                    "esta versión ha fallado al arrancar varias veces: no se                      buscarán actualizaciones hasta que arranque bien"
                );
            }

            let handle = preparar_backend(app);
            // Con el backend en pie y la ventana a punto de abrirse, el
            // arranque cuenta como bueno.
            updates::marcar_exito(&datos, VERSION);
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_backend_token,
            get_startup_status,
            get_license_status
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
