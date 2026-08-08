/** Captura de una zona de la interfaz —tal y como se ve— a un canvas.
 *
 * El PNG se componía redibujando solo las tiras. Quien recibía la imagen veía
 * doce trazados y nada más: ni la ganancia, ni la velocidad de papel, ni el
 * ritmo elegido, ni los fármacos encima, ni las medidas del inspector. Todo
 * eso está en pantalla y ninguno viajaba en el fichero.
 *
 * Aquí se serializa el DOM real dentro de un `<foreignObject>` y se rasteriza,
 * así que lo exportado es exactamente lo que había delante. No se usa
 * `getDisplayMedia` —que sí usa el vídeo— porque pedir permiso de compartir
 * pantalla para guardar una imagen convierte un clic en un diálogo, y porque el
 * resultado dependería de qué ventana elija el usuario en él.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Cómo se convierte un canvas a imagen. Es un parámetro y no una llamada
 * directa porque `toDataURL` no existe fuera de un navegador de verdad, y sin
 * esta costura la serialización no se podría probar. */
export type CanvasEncoder = (canvas: HTMLCanvasElement) => string;

const encodeToDataUrl: CanvasEncoder = (canvas) => canvas.toDataURL("image/png");

export interface CaptureOptions {
  /** Se pinta debajo del clon: el CSS de fondo vive en `body`, y en el SVG no
   * hay `body` que lo aplique. */
  background: string;
  /** Píxeles de imagen por píxel de pantalla. Por encima de 1 el texto sale
   * nítido, pero las tiras —que ya son mapas de bits— se interpolan. */
  scale?: number;
  encodeCanvas?: CanvasEncoder;
}

/** Un canvas no viaja en el XML: su contenido no está en el DOM, está en el
 * contexto de dibujo. Se cambia por una imagen ya rasterizada, con la misma
 * clase y el mismo tamaño, para que el CSS lo siga colocando igual. */
export function replaceCanvases(
  source: HTMLElement,
  clone: HTMLElement,
  encode: CanvasEncoder
): void {
  const originals = Array.from(source.querySelectorAll("canvas"));
  const clones = Array.from(clone.querySelectorAll("canvas"));

  originals.forEach((canvas, index) => {
    const target = clones[index];
    if (!target) return;
    const image = clone.ownerDocument.createElementNS(XHTML_NS, "img");
    image.setAttribute("src", encode(canvas));
    const className = target.getAttribute("class");
    if (className) image.setAttribute("class", className);
    const { width, height } = canvas.getBoundingClientRect();
    image.setAttribute(
      "style",
      `${target.getAttribute("style") ?? ""};width:${width}px;height:${height}px`
    );
    target.replaceWith(image);
  });
}

/** El valor de un `select` o de un `input` es una propiedad viva, no un
 * atributo: un clon serializado sale con la primera opción marcada y los
 * campos a cero. En una captura del puesto eso es mentir sobre qué ritmo
 * estaba puesto y a qué frecuencia. */
export function freezeFormState(source: HTMLElement, clone: HTMLElement): void {
  const paired = (selector: string) => {
    const originals = Array.from(source.querySelectorAll(selector));
    const clones = Array.from(clone.querySelectorAll(selector));
    return originals.map((element, index) => [element, clones[index]] as const);
  };

  for (const [original, copy] of paired("select")) {
    if (!copy) continue;
    const selectedIndex = (original as HTMLSelectElement).selectedIndex;
    Array.from(copy.querySelectorAll("option")).forEach((option, index) => {
      if (index === selectedIndex) option.setAttribute("selected", "selected");
      else option.removeAttribute("selected");
    });
  }

  for (const [original, copy] of paired("input")) {
    if (!copy) continue;
    const input = original as HTMLInputElement;
    copy.setAttribute("value", input.value);
    if (input.checked) copy.setAttribute("checked", "checked");
    else copy.removeAttribute("checked");
  }

  for (const [original, copy] of paired("textarea")) {
    if (!copy) continue;
    copy.textContent = (original as HTMLTextAreaElement).value;
  }
}

/** Todo el CSS del documento, en texto.
 *
 * Dentro del SVG no hay hojas enlazadas: si el CSS no viaja con el marcado, el
 * clon se pinta sin estilos. Las hojas de otro origen no dejan leer sus reglas
 * —lo impide el navegador, no un descuido— y se saltan en vez de tumbar la
 * captura entera. */
export function collectCss(document: Document): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) rules.push(rule.cssText);
    } catch {
      // Hoja de otro origen: sus reglas no son legibles desde aquí.
    }
  }
  return rules.join("\n");
}

export interface SvgMarkupParams {
  html: string;
  css: string;
  width: number;
  height: number;
  background: string;
  /** El tema activo, tal cual está en el elemento raíz. Dentro del SVG el
   * elemento raíz es el `<svg>`, así que sin esto `:root[data-theme="light"]`
   * no engancharía y la captura saldría siempre con el juego oscuro. */
  theme?: string | null;
}

export function buildSvgMarkup({
  html,
  css,
  width,
  height,
  background,
  theme,
}: SvgMarkupParams): string {
  const themeAttribute = theme ? ` data-theme="${theme}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}"${themeAttribute}>`,
    `<style><![CDATA[${css}]]></style>`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${html}</foreignObject>`,
    `</svg>`,
  ].join("");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("El navegador no pudo rasterizar la captura."));
    image.src = url;
  });
}

/** Rasteriza un elemento de la página a un canvas nuevo. */
export async function captureElement(
  node: HTMLElement,
  options: CaptureOptions
): Promise<HTMLCanvasElement> {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  if (width === 0 || height === 0) {
    throw new Error("La zona a capturar no tiene tamaño.");
  }

  const clone = node.cloneNode(true) as HTMLElement;
  // Medidas explícitas: dentro del SVG no hay ventana, y un alto en `dvh`
  // —que es como se dimensiona el puesto— no tendría contra qué resolverse.
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  replaceCanvases(node, clone, options.encodeCanvas ?? encodeToDataUrl);
  freezeFormState(node, clone);

  const markup = buildSvgMarkup({
    html: new XMLSerializer().serializeToString(clone),
    css: collectCss(node.ownerDocument),
    width,
    height,
    background: options.background,
    theme: node.ownerDocument.documentElement.dataset.theme ?? null,
  });

  // `data:` y no `blob:`. Con una URL de blob el navegador considera que el
  // canvas ha tocado un recurso ajeno, lo marca como contaminado y `toBlob`
  // falla con `SecurityError` justo al guardar: la captura se compone entera
  // y se pierde en el último paso.
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  );

  const scale = options.scale ?? 1;
  const out = document.createElement("canvas");
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);

  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Este navegador no permite componer la captura.");
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(image, 0, 0, out.width, out.height);
  return out;
}
