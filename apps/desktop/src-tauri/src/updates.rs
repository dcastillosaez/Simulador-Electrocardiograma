//! Actualizaciones: cuándo se miran y qué pasa si la nueva versión no arranca.
//!
//! La descarga y la verificación de firma las hace el updater de Tauri, que
//! comprueba el paquete contra una clave pública antes de instalarlo. Un
//! updater que ejecuta lo que le llega es un mecanismo de instalación remota de
//! malware con nuestro nombre encima, así que esa verificación no se toca.
//!
//! Lo que sí vive aquí son las dos decisiones que el updater no toma solo:
//!
//! - **Cuándo se comprueba.** Al arrancar y nunca durante el uso: nadie quiere
//!   una actualización a mitad de clase.
//! - **Qué pasa si la versión nueva no arranca.** Un contador de arranques
//!   fallidos en disco. Dos seguidos, y se deja de actualizar hasta que alguien
//!   mire: seguir descargando la misma versión rota es la forma de convertir un
//!   fallo en un ciclo.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Arranques fallidos consecutivos antes de dejar de actualizar.
///
/// Dos y no uno: un primer arranque puede fallar por causas que no son la
/// versión —un antivirus mirando, un disco ocupado— y degradar el producto al
/// primer tropiezo sería peor que el problema.
const FALLOS_PARA_RENDIRSE: u32 = 2;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct EstadoArranque {
    /// Versión que se está intentando arrancar.
    pub version: String,
    /// Arranques empezados y no confirmados.
    pub fallos: u32,
}

fn ruta_estado(dir_datos: &Path) -> PathBuf {
    dir_datos.join("arranque.json")
}

fn leer(dir_datos: &Path) -> EstadoArranque {
    std::fs::read_to_string(ruta_estado(dir_datos))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn escribir(dir_datos: &Path, estado: &EstadoArranque) {
    if let Ok(texto) = serde_json::to_string(estado) {
        let _ = std::fs::create_dir_all(dir_datos);
        let _ = std::fs::write(ruta_estado(dir_datos), texto);
    }
}

/// Marca que esta versión ha empezado a arrancar. Se llama **antes** de abrir
/// la ventana, porque lo que hay que detectar es justamente que no se llegue a
/// abrir.
pub fn marcar_intento(dir_datos: &Path, version: &str) {
    let mut estado = leer(dir_datos);
    if estado.version != version {
        // Versión distinta: el contador de la anterior no dice nada de esta.
        estado = EstadoArranque {
            version: version.to_string(),
            fallos: 0,
        };
    }
    estado.fallos += 1;
    escribir(dir_datos, &estado);
}

/// Marca que esta versión arrancó bien. Se llama cuando la interfaz ya está en
/// pantalla y el backend responde: antes de eso no se sabe.
pub fn marcar_exito(dir_datos: &Path, version: &str) {
    escribir(
        dir_datos,
        &EstadoArranque {
            version: version.to_string(),
            fallos: 0,
        },
    );
}

/// Si conviene buscar actualizaciones.
///
/// `false` cuando esta versión ya ha fallado varias veces seguidas: si la
/// instalada no arranca, traer otra encima solo añade una variable más a un
/// problema que alguien tiene que mirar.
pub fn deberia_actualizar(dir_datos: &Path, version: &str) -> bool {
    let estado = leer(dir_datos);
    !(estado.version == version && estado.fallos > FALLOS_PARA_RENDIRSE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ecg_updates_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn una_instalacion_nueva_actualiza() {
        let dir = temporal();
        assert!(deberia_actualizar(&dir, "1.0.0"));
    }

    #[test]
    fn un_arranque_bueno_deja_el_contador_a_cero() {
        let dir = temporal();
        marcar_intento(&dir, "1.0.0");
        marcar_exito(&dir, "1.0.0");
        marcar_intento(&dir, "1.0.0");
        assert!(deberia_actualizar(&dir, "1.0.0"));
    }

    #[test]
    fn tras_varios_fallos_seguidos_se_deja_de_actualizar() {
        // Seguir trayendo versiones sobre una instalación que no arranca es
        // convertir un fallo en un ciclo.
        let dir = temporal();
        for _ in 0..=FALLOS_PARA_RENDIRSE {
            marcar_intento(&dir, "1.0.0");
        }
        assert!(!deberia_actualizar(&dir, "1.0.0"));
    }

    #[test]
    fn el_contador_no_se_hereda_entre_versiones() {
        // Que la 1.0.0 no arrancara no dice nada de la 1.1.0.
        let dir = temporal();
        for _ in 0..=FALLOS_PARA_RENDIRSE {
            marcar_intento(&dir, "1.0.0");
        }
        assert!(deberia_actualizar(&dir, "1.1.0"));
    }

    #[test]
    fn un_estado_corrupto_no_bloquea_las_actualizaciones() {
        // Fallar hacia el lado que deja el producto usable.
        let dir = temporal();
        std::fs::write(ruta_estado(&dir), "{basura").unwrap();
        assert!(deberia_actualizar(&dir, "1.0.0"));
    }
}
