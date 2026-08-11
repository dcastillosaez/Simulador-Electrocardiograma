# Política de seguridad

Este es un simulador de ECG con fines docentes. No procesa datos de pacientes reales ni está pensado como herramienta de apoyo clínico — el aviso completo está en el `CLAUDE.md` del repositorio. Aun así, agradecemos que se reporte cualquier problema de seguridad de forma responsable.

## Versiones con soporte

El proyecto está en desarrollo activo y no publica versiones estables paralelas. Solo se da soporte a la rama `master`; cualquier corrección de seguridad se aplica ahí y no se retroportea a versiones anteriores.

## Cómo reportar una vulnerabilidad

La vía preferida es el [reporte privado de vulnerabilidades de GitHub](https://github.com/dcastillosaez/Simulador-Electrocardiograma/security/advisories/new): abre un aviso privado desde la pestaña *Security* del repositorio. Solo lo ven los mantenedores hasta que se publique, y permite adjuntar detalles técnicos y coordinar una corrección antes de hacerla pública.

Si prefieres otro canal, escribe a **dm.home.gestion@gmail.com** con una descripción del problema y, si es posible, los pasos para reproducirlo.

No abras un *issue* público para un fallo de seguridad todavía sin corregir.

## Qué esperar

Confirmación de recepción en unos días. A partir de ahí, el tiempo de respuesta depende de la gravedad y de la disponibilidad del mantenedor — es un proyecto personal, no un producto con SLA. Si el problema se confirma, se documentará como GitHub Security Advisory una vez publicada la corrección, con crédito a quien lo reportó si así lo desea.

## Alcance

Interesan sobre todo los problemas que comprometan la integridad de la simulación (por ejemplo, que un cliente pueda alterar el estado de otra sesión) o la seguridad del proceso de escritorio (el token que aísla la ventana del simulador de otros procesos del equipo, en `apps/api/src/ecg_api/desktop_auth.py`). Los avisos de dependencias transitivas sin corrección disponible — como los de la cadena GTK3 de `gtk-rs`, ya documentados en `apps/desktop/src-tauri/osv-scanner.toml` — no hace falta reportarlos: ya están triadas.
