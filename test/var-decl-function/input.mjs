// @ts-check

/**
 * @returns {string}
 * @param {number} a
 * */
const functionExpr = function (a, /** @type {string} */ b) {
  return "foo";
};

/**
 * @template {Record<string, any>} T
 * @param {T} a
 * */
const genericFunctionExpr = function (a, /** @type {T} */ b) {
  return "foo";
};

//==========================================

/**
 * @param {string} [a] - the first value.
 * */
const withOptionalParam = function (a) {
  return a;
};

/**
 * @param {string} [a] - the first value.
 * */
const withOptionalParamAndDefault = function (a = "default") {
  return a;
};

//==========================================

/**
 * @param {string} a - the first value.
 * */
const withExtraComments = function (
  a,
  /** @type {number} - the other value. */ b
) {
  return "foo";
};

/**
 * @param a - the first value.
 * */
const withoutTypes = function (a, /** the other value. */ b) {
  return "foo";
};

//==========================================

function outer() {
  /** @returns {string} */
  const inner = function () {
    return "foo";
  };

  /** @type {() => (string | 0)} */
  const func =
    Math.random() > 0.5
      ? inner
      : /** @returns {0} */ function () {
          return 0;
        };

  return func();
}

//==========================================

/** @returns {string} */
export const exportedFunction = function () {
  return "foo";
};
