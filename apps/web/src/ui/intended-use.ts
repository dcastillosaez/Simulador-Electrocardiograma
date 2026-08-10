/** El uso previsto, dicho donde se ve.
 *
 * El proyecto lo declara en su CLAUDE.md y el instalador lo lleva en sus
 * metadatos, pero quien abre la ventana no lee ninguna de las dos cosas. Desde
 * que esto se distribuye como un `.exe` que alguien puede tener abierto en un
 * hospital, el aviso tiene que estar **en la aplicación**: en pantalla mientras
 * se usa, y dentro de lo que se exporta, porque un PNG se reenvía y acaba lejos
 * de la ventana donde se generó.
 *
 * No es burocracia. Es la diferencia entre un simulador docente y algo que
 * alguien podría acabar mirando al lado de una cama.
 */

/** Versión corta, para la barra de estado: tiene que caber junto al resto. */
export const INTENDED_USE_SHORT = "Uso docente — no apto para diagnóstico";

/** Versión completa, para el PNG exportado y para donde haya sitio. */
export const INTENDED_USE_FULL =
  "Simulador docente. No es un dispositivo médico: no está destinado al " +
  "diagnóstico ni al tratamiento de pacientes.";
