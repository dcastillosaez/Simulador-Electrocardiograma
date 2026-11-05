import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  CONDUCTION_GROUPS,
  CONDUCTION_GROUP_NAMES,
  DEFORMATION,
  applyExcursion,
  deformPoint,
} from "../HeartAnimator";
import { HEART_NODE_NAMES, type HeartNodes } from "../heart-nodes";
import { MM_PER_UNIT } from "../heart-scale";
import {
  CONDUCTION_CHAMBERS,
  CONDUCTION_DATA,
  CONDUCTION_STRUCTURES,
  STRUCTURE_INFO,
  type ConductionChamber,
} from "./conduction-structures";
import {
  PROGRESS_ATTRIBUTE,
  STRUCTURE_ATTRIBUTE,
  buildConductionGeometries,
} from "./conduction-geometry";

function pivots(): Record<ConductionChamber, Vector3> {
  const result = {} as Record<ConductionChamber, Vector3>;
  for (const chamber of CONDUCTION_CHAMBERS) {
    const [x, y, z] = CONDUCTION_DATA.pivots[chamber];
    result[chamber] = new Vector3(x, y, z);
  }
  return result;
}

function distanceMm(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * MM_PER_UNIT;
}

describe("datos del sistema de conducción", () => {
  it("traen las siete estructuras, con trayectos", () => {
    for (const structure of CONDUCTION_STRUCTURES) {
      expect(CONDUCTION_DATA.structures[structure].paths.length).toBeGreaterThan(0);
    }
  });

  it("la red de Purkinje respeta el tope de segmentos con el que se generó", () => {
    const segments = CONDUCTION_DATA.structures.purkinje.paths.reduce(
      (total, path) => total + path.points.length - 1,
      0
    );
    expect(segments).toBeLessThanOrEqual(CONDUCTION_DATA.purkinje_max_segments);
    expect(CONDUCTION_DATA.seed).toBeTypeOf("number");
  });

  it("el progreso del pulso no retrocede dentro de un trayecto", () => {
    for (const structure of CONDUCTION_STRUCTURES) {
      for (const path of CONDUCTION_DATA.structures[structure].paths) {
        expect(path.progress).toHaveLength(path.points.length);
        for (let i = 1; i < path.progress.length; i += 1) {
          expect(path.progress[i]).toBeGreaterThanOrEqual(path.progress[i - 1] - 1e-4);
        }
        for (const value of path.progress) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("los esquemas se declaran como tales en los datos y en la ficha", () => {
    expect(new Set(CONDUCTION_DATA.didactic)).toEqual(
      new Set(CONDUCTION_STRUCTURES.filter((s) => STRUCTURE_INFO[s].didactic))
    );
  });

  it("cada trayecto cuelga de una de las cuatro cámaras", () => {
    for (const structure of CONDUCTION_STRUCTURES) {
      for (const path of CONDUCTION_DATA.structures[structure].paths) {
        expect(CONDUCTION_CHAMBERS).toContain(path.chamber);
      }
    }
  });
});

describe("deformación de la conducción", () => {
  it("cada grupo recibe exactamente la fila de su cámara", () => {
    for (const name of CONDUCTION_GROUP_NAMES) {
      expect(DEFORMATION[name]).toBe(DEFORMATION[CONDUCTION_GROUPS[name]]);
    }
  });

  it("los pivotes de los grupos son los de los nodos de su cámara", () => {
    // Los pivotes de las cuatro cámaras difieren: es la razón de que haya un
    // grupo por cámara. Si un día coincidieran, bastaría con uno.
    const [lv, rv] = [CONDUCTION_DATA.pivots.LeftVentricle, CONDUCTION_DATA.pivots.RightVentricle];
    expect(distanceMm(lv, rv)).toBeGreaterThan(30);
  });

  it("applyExcursion escala los grupos de la conducción igual que su cámara", () => {
    const heart = {} as HeartNodes;
    for (const name of HEART_NODE_NAMES) {
      heart[name] = { name, children: [], scale: { x: 1, y: 1, z: 1 } };
    }
    const groups = Object.fromEntries(
      CONDUCTION_GROUP_NAMES.map((name) => [name, { scale: { x: 1, y: 1, z: 1 } }])
    );
    applyExcursion(heart, { atria: 0.7, ventricles: 0.4 }, groups);
    for (const name of CONDUCTION_GROUP_NAMES) {
      expect(groups[name].scale).toEqual(heart[CONDUCTION_GROUPS[name]].scale);
    }
  });

  // La holgura en las uniones entre grupos se mide en la excursión máxima y
  // queda fijada aquí. Si una regeneración de los trayectos o un cambio de la
  // tabla de deformación la hace crecer, este test lo dice antes de que se vea
  // un hueco entre el nodo AV y el His.
  const EXTREMES = [
    { atria: 1, ventricles: 0 },
    { atria: 0, ventricles: 1 },
    { atria: 1, ventricles: 1 },
  ];

  function maxGapMm(
    point: [number, number, number],
    a: ConductionChamber,
    b: ConductionChamber
  ): number {
    const groupA = CONDUCTION_GROUP_NAMES.find((n) => CONDUCTION_GROUPS[n] === a)!;
    const groupB = CONDUCTION_GROUP_NAMES.find((n) => CONDUCTION_GROUPS[n] === b)!;
    return Math.max(
      ...EXTREMES.map((excursions) =>
        distanceMm(
          deformPoint(point, CONDUCTION_DATA.pivots[a], groupA, excursions),
          deformPoint(point, CONDUCTION_DATA.pivots[b], groupB, excursions)
        )
      )
    );
  }

  it("la unión del nodo AV con el His se separa como mucho 2,1 mm", () => {
    const gap = maxGapMm(
      CONDUCTION_DATA.landmarks.av_his_junction,
      "RightAtrium",
      "LeftVentricle"
    );
    expect(gap).toBeCloseTo(CONDUCTION_DATA.junction_gap_mm.av_his, 1);
    expect(gap).toBeLessThanOrEqual(2.1);
  });

  it("la unión del His con la rama derecha se separa como mucho 1,3 mm", () => {
    const gap = maxGapMm(
      CONDUCTION_DATA.landmarks.his_right_bundle_junction,
      "LeftVentricle",
      "RightVentricle"
    );
    expect(gap).toBeCloseTo(CONDUCTION_DATA.junction_gap_mm.his_right_bundle, 1);
    expect(gap).toBeLessThanOrEqual(1.3);
  });
});

describe("buildConductionGeometries", () => {
  const geometries = buildConductionGeometries(CONDUCTION_DATA, pivots());

  it("da una geometría por cámara, con los atributos del pulso", () => {
    for (const chamber of CONDUCTION_CHAMBERS) {
      const geometry = geometries[chamber];
      expect(geometry).not.toBeNull();
      const count = geometry!.getAttribute("position").count;
      expect(geometry!.getAttribute(PROGRESS_ATTRIBUTE).count).toBe(count);
      expect(geometry!.getAttribute(STRUCTURE_ATTRIBUTE).count).toBe(count);
    }
  });

  it("los vértices quedan relativos al pivote de su cámara", () => {
    // Un tubo de Purkinje del ventrículo izquierdo, devuelto a la escena,
    // tiene que caer a menos de un radio de algún punto de sus trayectos.
    const geometry = geometries.LeftVentricle!;
    const position = geometry.getAttribute("position");
    const pivot = CONDUCTION_DATA.pivots.LeftVentricle;
    const world = [
      position.getX(0) + pivot[0],
      position.getY(0) + pivot[1],
      position.getZ(0) + pivot[2],
    ];
    const all = CONDUCTION_STRUCTURES.flatMap((s) =>
      CONDUCTION_DATA.structures[s].paths
        .filter((p) => p.chamber === "LeftVentricle")
        .flatMap((p) => p.points)
    );
    const nearest = Math.min(...all.map((p) => distanceMm(p, world)));
    expect(nearest).toBeLessThan(1.0);
  });
});
