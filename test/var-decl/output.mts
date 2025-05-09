function simple() {
  const var1: number | null = 1;
}
function secondDeclNoAnnotation() {
  const var1: number | null = 1,
    var2 = 3;
}
function secondDeclWithAnnotation() {
  const var1: number | null = 1,
    var2: number | string = 3;
}
function manyDeclsWithIndividualAnnotations() {
  const var1: number | null = 1,
    var2: number | string = 2;
}
function arrayPattern() {
  const [a, b]: [number | null, number | null] = [1, null];
}
function objectPattern() {
  const {
    a,
    b,
  }: {
    a: number | null;
    b: number | null;
  } = {
    a: 1,
    b: null,
  };
}
function generic() {
  const map: Map<string, string> = new Map();
}

/** @type {string | null} */
export const exported = null;
