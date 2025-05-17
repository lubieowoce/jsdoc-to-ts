// @ts-check

/**
 * @typedef {number} Example
 */

function containsTypedef() {
  /**
   * @typedef {string} NestedExample
   */

  /** @type {NestedExample} */
  const x = "foo";
  return x;
}
