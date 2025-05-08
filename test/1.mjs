// /** @returns {string} */
// function functionDeclaration() {
//   return "foo";
// }

// /** @returns {string} */
// export function insideExportDeclaration() {
//   return "foo";
// }

function wrapper1() {
  /** @type {number | null} */
  const variable = null;
  return variable;
}

function wrapper2() {
  const var1 = /** @type {number | null} */ (null);
  const var2 = /** @type {number | null} */ (2 + 2);
}
