//! Dónde está el backend, y en qué estado.
//!
//! En G1 esto solo recuerda una dirección fija de desarrollo. La pieza existe
//! ya, en su sitio y con su forma definitiva, porque es la costura por la que
//! entrará G2: cuando el shell arranque el proceso de FastAPI, lo único que
//! cambia es quién rellena `base_url` — ni la interfaz ni los comandos se
//! enteran.

use std::sync::Mutex;

/// En qué punto del arranque está el backend. La interfaz lo enseña en el
/// splash: una barra de progreso que sube sola miente, y cuando el arranque
/// tarda diez segundos el usuario merece saber si está migrando la base de
/// datos o esperando a que el motor responda.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendStatus {
    /// Todavía no se ha lanzado (G2).
    Pending,
    /// Responde a `/api/health`.
    Ready,
    /// No se pudo arrancar o no respondió a tiempo.
    Failed,
}

struct State {
    base_url: String,
    status: BackendStatus,
}

pub struct BackendHandle {
    state: Mutex<State>,
}

impl BackendHandle {
    /// El backend de desarrollo: el que levanta `arrancar.bat`.
    ///
    /// Permite trabajar en la ventana nativa contra el backend de siempre,
    /// sin esperar a que G2 empaquete Python. Y deja claro por qué el puerto
    /// fijo no puede sobrevivir a G2: dos instalaciones abiertas a la vez se
    /// pelearían por el 8000.
    pub fn development() -> Self {
        Self {
            state: Mutex::new(State {
                base_url: "http://127.0.0.1:8000".to_string(),
                status: BackendStatus::Ready,
            }),
        }
    }

    pub fn base_url(&self) -> String {
        self.state.lock().expect("estado envenenado").base_url.clone()
    }

    pub fn status(&self) -> BackendStatus {
        self.state.lock().expect("estado envenenado").status
    }

    /// Lo usará G2 cuando el puerto efímero esté elegido y `/api/health`
    /// responda.
    #[allow(dead_code)]
    pub fn set_ready(&self, base_url: String) {
        let mut state = self.state.lock().expect("estado envenenado");
        state.base_url = base_url;
        state.status = BackendStatus::Ready;
    }

    #[allow(dead_code)]
    pub fn set_failed(&self) {
        self.state.lock().expect("estado envenenado").status = BackendStatus::Failed;
    }
}
