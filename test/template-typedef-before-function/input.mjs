// @ts-check

/**
 * @template T
 * @typedef {T & {__tag?: 'tagged' }} Tagged1<T>
 */

function afterTypedef1() {
  return /** @type {Tagged1<number>} */ (3);
}

/**
 * @template T
 * @typedef {T & {__tag?: 'tagged' }} Tagged2<T>
 */

export function afterTypedef2() {
  return /** @type {Tagged2<number>} */ (3);
}

//==========================================

function beforeInnerFunctionDecl() {
  /**
   * @template T
   * @typedef {T & {__tag?: 'tagged' }} InnerTagged<T>
   */

  function afterTypedef2(/** @type {number} */ x) {
    return /** @type {InnerTagged<number>} */ (x);
  }
}

function beforeInnerArrowFunction() {
  /**
   * @template T
   * @typedef {T & {__tag?: 'tagged' }} InnerTagged<T>
   */

  const afterTypedef2 = () => {
    return /** @type {InnerTagged<number>} */ (3);
  };
}

function beforeInnerFunctionExpr() {
  /**
   * @template T
   * @typedef {T & {__tag?: 'tagged' }} InnerTagged<T>
   */

  const afterTypedef2 = function () {
    return /** @type {InnerTagged<number>} */ (3);
  };
}
