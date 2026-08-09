//! El proceso del backend: dónde está, cómo se arranca y cómo se para.
//!
//! El shell lanza `ecg-api.exe` como proceso hijo, espera a que anuncie en qué
//! puerto escucha, y se lo dice a la interfaz. Tres detalles que no son
//! adorno:
//!
//! - **El puerto lo elige el sistema.** Un 8000 fijo colisiona con lo que sea
//!   que el usuario tenga levantado, y con una segunda instancia del propio
//!   simulador.
//! - **El token lo genera este proceso.** El backend escucha en 127.0.0.1, que
//!   alcanza cualquier programa del equipo; el token distingue a nuestra
//!   ventana del resto.
//! - **El hijo entra en un job object.** Para que muera con el padre aunque el
//!   padre muera de mala manera. Ver `job.rs`.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use rand::Rng;

#[cfg(windows)]
use crate::job::KillOnCloseJob;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Sin ventana de consola detrás de la aplicación. Es exactamente lo que la
/// fase G existe para que el usuario no vea.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Cuánto se espera a que el backend anuncie su puerto. Generoso a propósito:
/// el primer arranque en una máquina fría incluye descomprimir el runtime de
/// Python y migrar la base de datos.
const ARRANQUE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendStatus {
    Pending,
    Ready,
    Failed,
}

struct State {
    base_url: String,
    token: String,
    status: BackendStatus,
    child: Option<Child>,
}

pub struct BackendHandle {
    state: Mutex<State>,
    #[cfg(windows)]
    _job: Option<KillOnCloseJob>,
}

impl BackendHandle {
    /// El backend de desarrollo: el que levanta `arrancar.bat`.
    pub fn development() -> Self {
        Self {
            state: Mutex::new(State {
                base_url: "http://127.0.0.1:8000".to_string(),
                token: String::new(),
                status: BackendStatus::Ready,
                child: None,
            }),
            #[cfg(windows)]
            _job: None,
        }
    }

    /// Arranca el backend empaquetado y espera a que diga por dónde escucha.
    pub fn spawn(exe: &Path, data_dir: &Path) -> Result<Self, String> {
        let token: String = {
            let mut rng = rand::thread_rng();
            (0..32)
                .map(|_| {
                    const ALFABETO: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
                    ALFABETO[rng.gen_range(0..ALFABETO.len())] as char
                })
                .collect()
        };

        std::fs::create_dir_all(data_dir)
            .map_err(|e| format!("no se pudo preparar la carpeta de datos: {e}"))?;
        let db_path = data_dir.join("simulador.sqlite");

        let mut cmd = Command::new(exe);
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env("DATABASE_URL", format!("sqlite+aiosqlite:///{}", db_path.display()))
            .env("DESKTOP_TOKEN", &token)
            // Un escritorio es un usuario: el aforo de aula aquí solo sirve
            // para dejar entrar a otros procesos del equipo.
            .env("MAX_WS_CONNECTIONS", "3")
            .env("MAX_WS_CONNECTIONS_PER_CLIENT", "3")
            .env("TRUST_PROXY", "false");

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("no se pudo arrancar el motor de simulación: {e}"))?;

        // El job, ANTES de esperar nada: si el arranque se cuelga y el usuario
        // mata el shell, el hijo tiene que caer con él igualmente.
        #[cfg(windows)]
        let job = match KillOnCloseJob::new() {
            Ok(job) => {
                if let Err(e) = job.assign(&child) {
                    // No es fatal: la aplicación funciona igual, pero conviene
                    // que quede dicho que la red de seguridad no está puesta.
                    eprintln!("aviso: no se pudo asignar el backend al job: {e}");
                }
                Some(job)
            }
            Err(e) => {
                eprintln!("aviso: no se pudo crear el job object: {e}");
                None
            }
        };

        let puerto = match esperar_puerto(&mut child) {
            Ok(puerto) => puerto,
            Err(e) => {
                let _ = child.kill();
                return Err(e);
            }
        };

        Ok(Self {
            state: Mutex::new(State {
                base_url: format!("http://127.0.0.1:{puerto}"),
                token,
                status: BackendStatus::Ready,
                child: Some(child),
            }),
            #[cfg(windows)]
            _job: job,
        })
    }

    pub fn base_url(&self) -> String {
        self.state.lock().expect("estado envenenado").base_url.clone()
    }

    pub fn token(&self) -> String {
        self.state.lock().expect("estado envenenado").token.clone()
    }

    pub fn status(&self) -> BackendStatus {
        self.state.lock().expect("estado envenenado").status
    }

    /// Apagado ordenado. Se llama al cerrar la ventana.
    ///
    /// El job object garantiza que el hijo no sobreviva pase lo que pase, pero
    /// eso es la red, no el procedimiento: matarlo aquí libera el puerto y la
    /// memoria de inmediato en vez de dejarlo al capricho de cuándo el sistema
    /// destruye el job.
    pub fn shutdown(&self) {
        let mut state = self.state.lock().expect("estado envenenado");
        if let Some(child) = state.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.child = None;
        state.status = BackendStatus::Pending;
    }
}

/// Lee la salida del backend hasta encontrar el anuncio del puerto.
///
/// El contrato está en `apps/api/packaging/entrypoint.py`: una línea de JSON
/// `{"event":"listening","port":N}` en cuanto el puerto está elegido. Se lee en
/// un hilo aparte con un plazo, porque un backend que arranca mal y no escribe
/// nada dejaría la ventana esperando para siempre.
fn esperar_puerto(child: &mut Child) -> Result<u16, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "el motor de simulación no expuso su salida".to_string())?;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for linea in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(puerto) = puerto_de(&linea) {
                let _ = tx.send(puerto);
                return;
            }
        }
    });

    rx.recv_timeout(ARRANQUE_TIMEOUT).map_err(|_| {
        "el motor de simulación no respondió a tiempo. Revisa el registro en la \
         carpeta de datos de la aplicación."
            .to_string()
    })
}

/// El puerto de una línea del backend, si la línea es el anuncio.
///
/// Separado para poder probarlo: el resto de `esperar_puerto` necesita un
/// proceso de verdad, y esto es donde está la lógica que puede equivocarse.
pub fn puerto_de(linea: &str) -> Option<u16> {
    let valor: serde_json::Value = serde_json::from_str(linea).ok()?;
    if valor.get("event")?.as_str()? != "listening" {
        return None;
    }
    u16::try_from(valor.get("port")?.as_u64()?).ok()
}

/// Dónde está el backend empaquetado.
///
/// Empaquetado vive junto al ejecutable, en `resources`. En desarrollo, en el
/// `dist` que deja PyInstaller. Se prueban las dos para poder trabajar en la
/// ventana nativa sin reinstalar nada.
pub fn localizar_backend(exe_dir: &Path) -> Option<PathBuf> {
    let candidatos = [
        exe_dir.join("resources/ecg-api/ecg-api.exe"),
        exe_dir.join("ecg-api/ecg-api.exe"),
        exe_dir.join("../../../../api/packaging/dist/ecg-api/ecg-api.exe"),
    ];
    candidatos.into_iter().find(|c| c.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_el_anuncio_del_puerto() {
        let linea = r#"{"event": "listening", "host": "127.0.0.1", "port": 13106}"#;
        assert_eq!(puerto_de(linea), Some(13106));
    }

    #[test]
    fn ignora_las_lineas_de_log() {
        // El backend escribe su log por la misma salida: confundir una línea
        // de log con el anuncio dejaría a la interfaz apuntando a un puerto
        // inventado.
        assert_eq!(puerto_de("2026-08-09 INFO arrancando"), None);
        assert_eq!(puerto_de(r#"{"event": "otra cosa", "port": 1}"#), None);
    }

    #[test]
    fn rechaza_un_puerto_imposible() {
        assert_eq!(puerto_de(r#"{"event":"listening","port":99999}"#), None);
    }
}
