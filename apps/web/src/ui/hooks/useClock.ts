import { useEffect, useState } from "react";

/** Fecha y hora local, refrescada cada segundo.
 *
 * En un registro clínico la hora no es decoración: una tira de ritmo sin
 * sello temporal no se puede situar en la historia del paciente. Aquí es
 * docencia, pero la costumbre se enseña desde el principio.
 *
 * Se alinea al siguiente segundo exacto en vez de disparar cada 1000 ms desde
 * el montaje: un intervalo suelto va derivando y el reloj se salta segundos a
 * la vista. Con el realineado, el salto de dígito coincide con el del reloj
 * del sistema.
 */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId: number;

    const scheduleNextTick = () => {
      const msUntilNextSecond = 1000 - (Date.now() % 1000);
      timeoutId = window.setTimeout(() => {
        setNow(new Date());
        scheduleNextTick();
      }, msUntilNextSecond);
    };

    scheduleNextTick();
    return () => window.clearTimeout(timeoutId);
  }, []);

  return now;
}

/** `2026-07-30 17:04:12`. ISO sin la T ni la zona: es lo que se lee de un
 * vistazo, y la zona ya la aporta el contexto de quien mira la pantalla. */
export function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
