import type { MatrixDef, Scalar } from "./model.js";

export type Combination = Record<string, string>;

// Expands a matrix definition into the list of combinations: the cross
// product of all variables, minus "exclude" matches, plus "include" entries.
export function expandMatrix(def: MatrixDef): Combination[] {
  const vars: [string, Scalar[]][] = [];
  for (const [key, value] of Object.entries(def)) {
    if (key === "exclude" || key === "include") continue;
    vars.push([key, value as Scalar[]]);
  }

  let combos: Combination[] = vars.length === 0 ? [] : [{}];
  for (const [key, values] of vars) {
    combos = combos.flatMap((combo) => values.map((v) => ({ ...combo, [key]: String(v) })));
  }

  const excludes = (def.exclude ?? []) as Record<string, Scalar>[];
  combos = combos.filter(
    (combo) => !excludes.some((ex) => Object.entries(ex).every(([k, v]) => combo[k] === String(v)))
  );

  const includes = (def.include ?? []) as Record<string, Scalar>[];
  for (const inc of includes) {
    combos.push(Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, String(v)])));
  }
  return combos;
}

export function comboLabel(combo: Combination): string {
  return Object.entries(combo)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
