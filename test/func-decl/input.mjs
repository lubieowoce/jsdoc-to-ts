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

//==========================================

/**
 * This function takes an object parameter defined via multiple at-param lines.
 * @param {object} arg
 * @param {Record<string, any>} arg.one
 * @param {number=} arg.two - a description for two
 * @param {number} [arg.three]
 * @param {number} [arg.four=42] - a description for four
 *
 * @param {string} more
 */
function takesObject(arg, more) {}

/**
 * This function takes an optional object parameter defined via multiple at-param lines.
 *
 * @param {string} more
 *
 * @param {object} [arg] a description for `arg`.
 * @param {Record<string, any>} arg.one
 * @param {number=} arg.two - a description for two
 * @param {number} [arg.three]
 * @param {number} [arg.four=42] - a description for four
 */
function takesOptionalObject(more, arg) {}

//==========================================

/** @returns {string} */
export function exportedFunctionDeclaration() {
  return "foo";
}
