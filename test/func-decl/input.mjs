// @ts-check

/**
 * @returns {string}
 * @param {number} a
 * */
function functionDeclaration(a, /** @type {string} */ b) {
  return "foo";
}

/**
 * @template T
 * @param {T} a
 * */
function genericFunctionDeclaration(a, /** @type {T} */ b) {
  return "foo";
}

/** @returns {string} */
export function exportedFunctionDeclaration() {
  return "foo";
}
