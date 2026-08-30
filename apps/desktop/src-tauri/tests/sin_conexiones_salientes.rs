//! El escritorio no habla con la red, y este test es lo que lo defiende.
//!
//! `docs/instalacion.md` le promete a quien apruebe la instalación —un
//! departamento de informática de un hospital, la secretaría de una facultad—
//! que el programa no hace ninguna conexión saliente: ni actualizaciones, ni
//! telemetría, ni nada. Esa promesa es la que hace que el despliegue se apruebe
//! en una tarde en vez de entrar en una cola de revisión de meses.
//!
//! Una promesa así no se sostiene con buena voluntad. Basta con que alguien
//! añada `tauri-plugin-updater` para arreglar otra cosa, y la documentación que
//! ya está distribuida pasa a ser mentira **sin que nadie se entere**: el
//! programa seguiría funcionando igual de bien, y ese es justo el problema.
//!
//! Así que la propiedad se comprueba donde se decide: en las dependencias
//! declaradas y en el código que registra plugins. Si este test falla, no es un
//! fallo — es la pregunta de si la decisión de estar desconectado sigue en pie.
//! Está contestada en `docs/fase-g/estado.md`.
use std::path::{Path, PathBuf};

/// Crates que abren una conexión saliente, o que existen para eso.
///
/// No es la lista de todo lo que puede hablar por la red: `tauri` mismo
/// arrastra media pila HTTP por debajo. Es la lista de lo que hay que
/// **declarar a propósito** para usarla, que es donde se toma la decisión.
const PROHIBIDAS: &[&str] = &[
    "tauri-plugin-updater",
    "tauri-plugin-http",
    "tauri-plugin-upload",
    "reqwest",
    "ureq",
    "isahc",
    "attohttpc",
    "curl",
    "surf",
    "hyper",
    "tungstenite",
    "tokio-tungstenite",
];

fn raiz_crate() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn leer(ruta: &Path) -> String {
    std::fs::read_to_string(ruta)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", ruta.display()))
}

/// Los nombres de las dependencias declaradas en un `Cargo.toml`.
///
/// A mano y sin parsear TOML de verdad: meter un `toml` en las dependencias de
/// desarrollo para vigilar las dependencias tiene su gracia, pero es una
/// dependencia más que mantener para leer catorce líneas.
///
/// Reconoce las dos formas que usa este manifiesto:
///
/// ```toml
/// [dependencies]
/// serde = "1"                                    # -> "serde"
///
/// [target.'cfg(windows)'.dependencies.windows-sys]  # -> "windows-sys"
/// version = "0.59"
/// ```
fn dependencias(manifiesto: &str) -> Vec<String> {
    let mut nombres = Vec::new();
    let mut dentro = false;

    for linea in manifiesto.lines() {
        let linea = linea.trim();

        if let Some(seccion) = linea.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let seccion = seccion.trim();
            // `[dependencies.foo]` y `[target.'cfg(...)'.dependencies.foo]`
            // declaran la dependencia en el propio nombre de la sección.
            if let Some((_, cola)) = seccion.split_once("dependencies.") {
                nombres.push(cola.trim().trim_matches('"').to_string());
                dentro = false;
                continue;
            }
            dentro = seccion.ends_with("dependencies");
            continue;
        }

        if !dentro || linea.is_empty() || linea.starts_with('#') {
            continue;
        }
        if let Some((clave, _)) = linea.split_once('=') {
            nombres.push(clave.trim().trim_matches('"').to_string());
        }
    }
    nombres
}

#[test]
fn no_se_declara_ninguna_dependencia_que_hable_por_la_red() {
    let manifiesto = leer(&raiz_crate().join("Cargo.toml"));
    let declaradas = dependencias(&manifiesto);

    let intrusas: Vec<&String> = declaradas
        .iter()
        .filter(|d| PROHIBIDAS.contains(&d.as_str()))
        .collect();

    assert!(
        intrusas.is_empty(),
        "el escritorio ha dejado de estar desconectado: {intrusas:?}.\n\
         `docs/instalacion.md` promete que no hay conexiones salientes y esa \
         promesa ya está distribuida. Si la decisión ha cambiado a propósito, \
         hay que actualizar ese documento, avisar a los centros donde la \
         aplicación esté aprobada como offline, y quitar de PROHIBIDAS lo que \
         ahora sí se usa."
    );
}

#[test]
fn no_se_registra_ningun_plugin_de_tauri() {
    let main = leer(&raiz_crate().join("src/main.rs"));

    // `Builder::plugin(...)` es la única puerta por la que entra un plugin. Sin
    // esa llamada, tenerlo en las dependencias tampoco lo activaría — pero las
    // dos cosas juntas son lo que hace la promesa comprobable de un vistazo.
    assert!(
        !main.contains(".plugin("),
        "`main.rs` registra un plugin de Tauri. Si es uno que usa la red, \
         `docs/instalacion.md` ha dejado de ser cierto; si no lo es, añade la \
         excepción aquí y explica cuál es."
    );
}

#[test]
fn el_documento_de_instalacion_sigue_prometiendo_lo_mismo() {
    // El otro extremo del cable. Los dos tests anteriores vigilan que el
    // binario no cambie por debajo del documento; este vigila que el documento
    // no cambie por debajo del binario, que es como se llega a prometer algo
    // que ya no se comprueba.
    let doc = raiz_crate().join("../../../docs/instalacion.md");
    let texto = leer(&doc);

    assert!(
        texto.contains("No hay conexiones salientes"),
        "`docs/instalacion.md` ya no dice que no haya conexiones salientes. Si \
         la promesa se ha retirado, estos tests sobran y hay que borrarlos; \
         dejarlos vigilando una promesa que ya no se hace es ruido."
    );
}

#[cfg(test)]
mod del_lector_de_dependencias {
    use super::dependencias;

    #[test]
    fn lee_las_dos_formas_de_declarar_una_dependencia() {
        let manifiesto = r#"
[package]
name = "algo"

[build-dependencies]
tauri-build = { version = "2" }

[dependencies]
tauri = { version = "2", features = [] }
# un comentario
serde_json = "1"

[target.'cfg(windows)'.dependencies.windows-sys]
version = "0.59"
"#;
        let leidas = dependencias(manifiesto);
        assert!(leidas.contains(&"tauri".to_string()));
        assert!(leidas.contains(&"serde_json".to_string()));
        assert!(leidas.contains(&"windows-sys".to_string()));
        assert!(leidas.contains(&"tauri-build".to_string()));
        // `name = "algo"` está en `[package]`, no en una sección de
        // dependencias: leerlo como dependencia sería un falso positivo.
        assert!(!leidas.contains(&"name".to_string()));
    }
}
