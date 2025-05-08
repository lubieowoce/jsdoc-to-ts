// @ts-check

function simple() {
  /** @type {number | null} */
  const var1 = 1;
}

function secondDeclNoAnnotation() {
  /** @type {number | null} */
  const var1 = 1,
    var2 = 3;
}
function secondDeclWithAnnotation() {
  /** @type {number | null} */
  const var1 = 1,
    /** @type {number | string} */
    var2 = 3;
}

function manyDeclsWithIndividualAnnotations() {
  const /** @type {number | null} */
    var1 = 1,
    /** @type {number | string} */
    var2 = 2;
}

function arrayPattern() {
  /** @type {[number | null, number | null]} */
  const [a, b] = [1, null];
}

function objectPattern() {
  /** @type {{ a: number | null, b: number | null }} */
  const { a, b } = { a: 1, b: null };
}

/** @type {string | null} */
export const exported = null;
