// El shell de escritorio del simulador.
//
// Su trabajo es sostener la ventana y decirle a la interfaz dónde está el
// backend. Nada más: la lógica clínica vive en el motor, y la de simulación en
// FastAPI. Si algún día hay que tocar este fichero para cambiar cómo se
// simula, algo se ha colocado en el sitio equivocado.
//
// En G1 la dirección del backend es la de desarrollo. En G2 pasará a ser la del
// proceso que este mismo shell arranca en un puerto efímero, y lo único que
// cambiará es de dónde sale la cadena que devuelve `get_backend_url`: la
// interfaz ya la pide en tiempo de ejecución.

// Sin consola en release: una ventana de terminal detrás de la aplicación es
// exactamente lo que la fase G existe para que el usuario no vea.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use backend::BackendHandle;
use tauri::Manager;

/// Dónde escucha el backend. La interfaz lo pregunta al arrancar, antes de
/// crear el `SessionRuntime`.
#[tauri::command]
fn get_backend_url(state: tauri::State<BackendHandle>) -> String {
    state.base_url()
}

/// Estado del arranque, para que el splash pueda contar algo cierto en vez de
/// una barra que sube sola.
#[tauri::command]
fn get_startup_status(state: tauri::State<BackendHandle>) -> serde_json::Value {
    serde_json::json!({
        "backend": state.status(),
        "baseUrl": state.base_url(),
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // El handle vive en el estado de la aplicación: es lo que permite
            // que el comando y el cierre hablen del mismo proceso.
            app.manage(BackendHandle::development());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url, get_startup_status])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar la ventana del simulador");
}
