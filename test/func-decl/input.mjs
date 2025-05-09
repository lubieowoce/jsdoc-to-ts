// @ts-check

/**
 * @returns {string}
 * @param {number} a
 * */
function functionDeclaration(a, /** @type {string} */ b) {
  return "foo";
}

/**
 * @template {Record<string, any>} T
 * @param {T} a
 * */
function genericFunctionDeclaration(a, /** @type {T} */ b) {
  return "foo";
}

//==========================================

/**
 * @param {string} [a] - the first value.
 * */
function withOptionalParam(a) {
  return a;
}

/**
 * @param {string} [a] - the first value.
 * */
function withOptionalParamAndDefault(a = "default") {
  return a;
}

//==========================================

/**
 * @param {string} a - the first value.
 * */
function withExtraComments(a, /** @type {number} - the other value. */ b) {
  return "foo";
}

/**
 * @param a - the first value.
 * */
function withoutTypes(a, /** the other value. */ b) {
  return "foo";
}

/** @returns {string} */
export function exportedFunctionDeclaration() {
  return "foo";
}
