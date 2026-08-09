//! Licencia firmada, verificada aquí y no en Python.
//!
//! Un `.pyc` se sustituye con un editor de texto y un intérprete embebido carga
//! lo que le pongas delante; el binario de Tauri es bastante más caro de
//! parchear. Ninguna de las dos es inviolable —un programa que se ejecuta en la
//! máquina del usuario se puede copiar— y ese no es el objetivo: lo que se
//! busca es frenar la copia casual, pasarse el `.exe` entre compañeros.
//!
//! **Funciona sin Internet.** Un hospital sin conexión no puede quedarse sin
//! simulador porque un servidor de licencias no responda. La comprobación en
//! línea, cuando exista, será para renovar y revocar, no para arrancar.
//!
//! El fichero es JSON con la firma al lado:
//!
//! ```json
//! { "payload": { "product": "SimuladorECG", "edition": "Professional",
//!                "customer": "Hospital X", "expires": "2027-12-31",
//!                "features": ["ecg", "pharmacology"] },
//!   "signature": "<base64 de la firma Ed25519 del payload canónico>" }
//! ```

use std::path::Path;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Clave pública del emisor. La privada vive fuera de este repositorio y de
/// esta máquina; con solo la pública no se pueden fabricar licencias.
///
/// Vacía mientras no haya emisor real: sin clave no se valida ninguna licencia
/// y la aplicación se comporta como si no hubiera ninguna, que es el estado en
/// el que está el producto hoy.
const CLAVE_PUBLICA_B64: &str = "";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub product: String,
    pub edition: String,
    pub customer: String,
    /// `YYYY-MM-DD`. Se compara como cadena a propósito: en formato ISO el
    /// orden lexicográfico y el cronológico coinciden, y así no hace falta
    /// arrastrar una librería de fechas para comparar dos días.
    pub expires: String,
    #[serde(default)]
    pub features: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct LicenseFile {
    payload: serde_json::Value,
    signature: String,
}

/// En qué situación está la licencia. La interfaz decide qué enseñar; aquí solo
/// se constata.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum LicenseStatus {
    /// No hay fichero de licencia. **No es un error**: es el estado normal de
    /// una instalación de evaluación, y la aplicación tiene que funcionar.
    Absent,
    /// Firmada por quien dice y dentro de plazo.
    Valid { payload: LicensePayload },
    /// Firmada correctamente, pero caducada. Se distingue de `Invalid` porque
    /// son dos conversaciones distintas: una se arregla renovando y la otra
    /// significa que el fichero está manipulado.
    Expired { payload: LicensePayload, since: String },
    /// La firma no cuadra, el fichero está corrupto, o no hay clave con la que
    /// comprobarlo.
    Invalid { reason: String },
}

impl LicenseStatus {
    /// Si una funcionalidad está habilitada.
    ///
    /// Sin licencia, **todo está habilitado**. Es deliberado: mientras no haya
    /// modelo comercial decidido —qué ediciones existen y qué incluye cada
    /// una— capar funciones sería inventarse el producto. El día que se decida,
    /// se cambia esta función y nada más.
    pub fn allows(&self, feature: &str) -> bool {
        match self {
            LicenseStatus::Valid { payload } => {
                payload.features.is_empty() || payload.features.iter().any(|f| f == feature)
            }
            _ => true,
        }
    }
}

/// El JSON canónico del payload: claves ordenadas, sin espacios.
///
/// La firma se calcula sobre estos bytes exactos. Firmar el texto del fichero
/// tal cual haría que un salto de línea distinto invalidara una licencia buena.
fn canonico(payload: &serde_json::Value) -> Result<Vec<u8>, String> {
    let mapa = payload
        .as_object()
        .ok_or_else(|| "el payload no es un objeto".to_string())?;
    let ordenado: std::collections::BTreeMap<_, _> = mapa.iter().collect();
    serde_json::to_vec(&ordenado).map_err(|e| e.to_string())
}

fn clave_publica() -> Option<VerifyingKey> {
    if CLAVE_PUBLICA_B64.is_empty() {
        return None;
    }
    let bytes = base64_decode(CLAVE_PUBLICA_B64).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    VerifyingKey::from_bytes(&arr).ok()
}

/// Lee y verifica la licencia. `hoy` en formato `YYYY-MM-DD`.
pub fn evaluate(ruta: &Path, hoy: &str) -> LicenseStatus {
    let texto = match std::fs::read_to_string(ruta) {
        Ok(t) => t,
        Err(_) => return LicenseStatus::Absent,
    };
    evaluate_str(&texto, hoy)
}

pub fn evaluate_str(texto: &str, hoy: &str) -> LicenseStatus {
    let fichero: LicenseFile = match serde_json::from_str(texto) {
        Ok(f) => f,
        Err(e) => {
            return LicenseStatus::Invalid {
                reason: format!("el fichero de licencia no se pudo leer: {e}"),
            }
        }
    };

    let Some(clave) = clave_publica() else {
        return LicenseStatus::Invalid {
            reason: "esta versión no lleva clave pública para validar licencias".into(),
        };
    };

    let mensaje = match canonico(&fichero.payload) {
        Ok(m) => m,
        Err(e) => return LicenseStatus::Invalid { reason: e },
    };

    let firma_bytes = match base64_decode(&fichero.signature) {
        Ok(b) => b,
        Err(e) => return LicenseStatus::Invalid { reason: e },
    };
    let firma_arr: [u8; 64] = match firma_bytes.try_into() {
        Ok(a) => a,
        Err(_) => {
            return LicenseStatus::Invalid {
                reason: "la firma no tiene el tamaño esperado".into(),
            }
        }
    };

    if clave.verify(&mensaje, &Signature::from_bytes(&firma_arr)).is_err() {
        return LicenseStatus::Invalid {
            reason: "la firma no corresponde a esta licencia".into(),
        };
    }

    let payload: LicensePayload = match serde_json::from_value(fichero.payload) {
        Ok(p) => p,
        Err(e) => {
            return LicenseStatus::Invalid {
                reason: format!("faltan campos en la licencia: {e}"),
            }
        }
    };

    // Comparación de cadenas ISO: ordenan igual que las fechas.
    if payload.expires.as_str() < hoy {
        let desde = payload.expires.clone();
        return LicenseStatus::Expired { payload, since: desde };
    }

    LicenseStatus::Valid { payload }
}

/// Base64 sin dependencias: son 30 líneas y evita arrastrar una crate más al
/// binario por decodificar dos campos.
fn base64_decode(entrada: &str) -> Result<Vec<u8>, String> {
    const TABLA: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut inversa = [255u8; 256];
    for (i, c) in TABLA.iter().enumerate() {
        inversa[*c as usize] = i as u8;
    }

    let limpio: Vec<u8> = entrada
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();

    let mut salida = Vec::with_capacity(limpio.len() * 3 / 4);
    let mut acumulador: u32 = 0;
    let mut bits = 0u32;
    for b in limpio {
        let valor = inversa[b as usize];
        if valor == 255 {
            return Err("carácter no válido en base64".into());
        }
        acumulador = (acumulador << 6) | valor as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            salida.push((acumulador >> bits) as u8);
        }
    }
    Ok(salida)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_fichero_no_es_un_error() {
        // Es el estado normal de una instalación de evaluación: la aplicación
        // tiene que funcionar, no fallar.
        let estado = evaluate(Path::new("no_existe.dat"), "2026-08-09");
        assert!(matches!(estado, LicenseStatus::Absent));
    }

    #[test]
    fn sin_licencia_todo_esta_habilitado() {
        // Mientras no haya modelo comercial decidido, capar funciones sería
        // inventarse el producto.
        assert!(LicenseStatus::Absent.allows("pharmacology"));
    }

    #[test]
    fn un_fichero_corrupto_no_pasa_por_valido() {
        let estado = evaluate_str("{esto no es json", "2026-08-09");
        assert!(matches!(estado, LicenseStatus::Invalid { .. }));
    }

    #[test]
    fn sin_clave_publica_no_se_valida_nada() {
        // Es el estado de esta versión: sin emisor, ninguna licencia se da por
        // buena. Lo contrario —aceptar sin verificar— sería peor que no tener
        // licencias.
        let fichero = r#"{"payload":{"product":"SimuladorECG"},"signature":"AAAA"}"#;
        assert!(matches!(
            evaluate_str(fichero, "2026-08-09"),
            LicenseStatus::Invalid { .. }
        ));
    }

    #[test]
    fn base64_decodifica_lo_conocido() {
        assert_eq!(base64_decode("aG9sYQ==").unwrap(), b"hola");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn base64_rechaza_basura() {
        assert!(base64_decode("no-es-base64!").is_err());
    }

    #[test]
    fn las_fechas_iso_ordenan_como_fechas() {
        // De esto depende la comprobación de caducidad, así que se comprueba.
        assert!("2026-08-09" < "2026-08-10");
        assert!("2026-12-31" < "2027-01-01");
    }
}
