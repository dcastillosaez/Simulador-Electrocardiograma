import { describe, expect, it } from "vitest";
import {
  buildSvgMarkup,
  collectCss,
  freezeFormState,
  replaceCanvases,
} from "./dom-snapshot";

const encode = () => "data:image/png;base64,FALSO";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("replaceCanvases", () => {
  it("cambia cada canvas por una imagen ya rasterizada", () => {
    // El contenido de un canvas no esta en el DOM, esta en el contexto de
    // dibujo: serializado tal cual, el ECG saldria como un hueco vacio.
    const source = mount('<canvas class="trazo"></canvas><canvas class="rejilla"></canvas>');
    const clone = source.cloneNode(true) as HTMLElement;

    replaceCanvases(source, clone, encode);

    const imagenes = clone.querySelectorAll("img");
    expect(clone.querySelectorAll("canvas")).toHaveLength(0);
    expect(imagenes).toHaveLength(2);
    expect(imagenes[0].getAttribute("src")).toBe("data:image/png;base64,FALSO");
  });

  it("conserva la clase de cada capa", () => {
    // Cada tira son dos canvas superpuestos por CSS. Sin la clase, las dos
    // imagenes se apilarian en el flujo y el trazo saldria debajo del ECG.
    const source = mount('<canvas class="trazo"></canvas>');
    const clone = source.cloneNode(true) as HTMLElement;

    replaceCanvases(source, clone, encode);

    expect(clone.querySelector("img")!.getAttribute("class")).toBe("trazo");
  });
});

describe("freezeFormState", () => {
  it("marca la opcion elegida del select", () => {
    // El valor de un select es una propiedad viva, no un atributo: el clon
    // saldria con la primera opcion, es decir, mintiendo sobre que ritmo habia.
    const source = mount(
      '<select><option value="a">A</option><option value="b">B</option></select>'
    );
    source.querySelector("select")!.value = "b";
    const clone = source.cloneNode(true) as HTMLElement;

    freezeFormState(source, clone);

    const opciones = clone.querySelectorAll("option");
    expect(opciones[0].hasAttribute("selected")).toBe(false);
    expect(opciones[1].hasAttribute("selected")).toBe(true);
  });

  it("fija el valor escrito en un input", () => {
    const source = mount('<input type="number" />');
    source.querySelector("input")!.value = "72";
    const clone = source.cloneNode(true) as HTMLElement;

    freezeFormState(source, clone);

    expect(clone.querySelector("input")!.getAttribute("value")).toBe("72");
  });
});

describe("collectCss", () => {
  it("recoge las reglas del documento", () => {
    const style = document.createElement("style");
    style.textContent = ".captura-test { color: red; }";
    document.head.appendChild(style);

    expect(collectCss(document)).toContain("captura-test");

    style.remove();
  });
});

describe("buildSvgMarkup", () => {
  const base = {
    html: '<div xmlns="http://www.w3.org/1999/xhtml">hola</div>',
    css: ".a{color:red}",
    width: 800,
    height: 600,
    background: "#111315",
  };

  it("mete el CSS dentro del SVG", () => {
    // Dentro del SVG no hay hojas enlazadas: si el CSS no viaja con el
    // marcado, la captura sale sin estilos.
    const svg = buildSvgMarkup(base);
    expect(svg).toContain("<![CDATA[.a{color:red}]]>");
    expect(svg).toContain('width="800"');
    expect(svg).toContain("<foreignObject");
  });

  it("pinta el fondo, que en el SVG no lo pone el body", () => {
    expect(buildSvgMarkup(base)).toContain('fill="#111315"');
  });

  it("lleva el tema al elemento raiz del SVG", () => {
    // Dentro del SVG el elemento raiz es el propio `svg`: sin este atributo,
    // `:root[data-theme="light"]` no engancharia y la captura saldria siempre
    // con el juego oscuro aunque la pantalla estuviera en claro.
    expect(buildSvgMarkup({ ...base, theme: "light" })).toContain('data-theme="light"');
    expect(buildSvgMarkup(base)).not.toContain("data-theme");
  });
});
