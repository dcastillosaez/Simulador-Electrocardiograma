//! Que los procesos hijo mueran con el padre. Siempre.
//!
//! El apagado ordenado del shell mata al backend cuando el usuario cierra la
//! ventana, y eso cubre el caso normal. No cubre el que de verdad ensucia la
//! máquina de alguien: que el shell muera sin llegar a ejecutar su propio
//! código de cierre —un `taskkill`, un cuelgue, un fallo del proceso—. Ahí el
//! backend se queda vivo, ocupando memoria y un puerto, hasta que alguien lo
//! mate a mano o reinicie.
//!
//! Un **job object** con `KILL_ON_JOB_CLOSE` traslada esa garantía al sistema
//! operativo: cuando el último handle del job se cierra —y todos los handles
//! de un proceso se cierran cuando el proceso muere, pase lo que pase—,
//! Windows mata a todo lo que hay dentro. No hay forma de saltárselo, que es
//! justo lo que se busca.

#![cfg(windows)]

use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// Un job del que no se sale.
///
/// Se guarda vivo en el estado de la aplicación: mientras exista, existe el
/// job; cuando el proceso del shell termina —por la vía que sea—, Windows
/// cierra sus handles, el job se destruye y con él todo lo que contenga.
pub struct KillOnCloseJob {
    handle: HANDLE,
}

// El handle es propiedad exclusiva de esta estructura y solo se usa para
// asignar procesos y para cerrarlo al final; moverlo entre hilos es seguro.
unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl KillOnCloseJob {
    pub fn new() -> io::Result<Self> {
        // SAFETY: se pasan punteros nulos (sin atributos de seguridad, sin
        // nombre), que es exactamente lo que la API documenta para un job
        // anónimo, y se comprueba el resultado antes de usarlo.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        // SAFETY: `info` es una estructura del tamaño que se declara y vive
        // hasta que la llamada retorna.
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            let err = io::Error::last_os_error();
            unsafe { CloseHandle(handle) };
            return Err(err);
        }

        Ok(Self { handle })
    }

    /// Mete un proceso en el job. A partir de aquí, no sobrevive al shell.
    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // SAFETY: el handle del hijo es válido mientras `child` viva, y esta
        // llamada retorna antes.
        let ok = unsafe {
            AssignProcessToJobObject(self.handle, child.as_raw_handle() as HANDLE)
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // Cerrar el handle es lo que dispara la matanza. No es limpieza
        // opcional: es el mecanismo.
        unsafe { CloseHandle(self.handle) };
    }
}
