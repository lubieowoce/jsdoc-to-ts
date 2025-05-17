// @ts-check

/**
 * @returns {string}
 * @param {number} a
 * */
const arrowFunction = (a, /** @type {string} */ b) => {
  return "foo";
};

/**
 * @template {Record<string, any>} T
 * @param {T} a
 * */
const genericArrowFunction = (a, /** @type {T} */ b) => {
  return "foo";
};

//==========================================

const onlyInlineTypes = (/** @type {string} */ a, /** @type {number} */ b) => {
  return a + b;
};

//==========================================

/**
 * @param {string} [a] - the first value.
 * */
const withOptionalParam = (a) => {
  return a;
};

/**
 * @param {string} [a] - the first value.
 * */
const withOptionalParamAndDefault = (a = "default") => {
  return a;
};

//==========================================

/**
 * @param {string} a - the first value.
 * */
const withExtraComments = (a, /** @type {number} - the other value. */ b) => {
  return "foo";
};

/**
 * @param a - the first value.
 * */
const withoutTypes = (a, /** the other value. */ b) => {
  return "foo";
};

//==========================================

function outer() {
  /** @returns {string} */
  const inner = () => {
    return "foo";
  };

  /** @type {() => (string | 0)} */
  const func = Math.random() > 0.5 ? inner : /** @returns {0} */ () => 0;

  return func();
}

//==========================================

/** @returns {string} */
export const exportedArrowFunction = () => {
  return "foo";
};
