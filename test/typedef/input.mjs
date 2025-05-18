// @ts-check

/**
 * This is a top level type
 * @typedef {Object} Foo - this is a trailing comment
 */

{
  /**
   * No other statements
   *
   * This should not conflict with the outer Foo,
   * because it's defined in a block scope
   * @typedef {Object} Foo - this is a trailing comment
   */
}

{
  /**
   * Leading comment
   *
   * This should not conflict with the outer Foo,
   * because it's defined in a block scope
   * @typedef {Object} Foo - this is a trailing comment
   */

  const DUMMY = 1;
}

{
  const DUMMY = 1;

  /**
   * Trailing comment
   *
   * This should also not conflict with the outer Foo,
   * because it's defined in a block scope
   * @typedef {Object} Foo - this is a trailing comment
   */
}

if (true) {
  /**
   * This should also not conflict with the outer Foo,
   * because it's defined in an if
   * @typedef {Object} Foo - this is a trailing comment
   */
}

/**
 * A description line at the start.
 * @typedef {Object} SpecialType - creates a new type named 'SpecialType'
 * @property {string} prop1 - a string property of SpecialType
 * @property {number} prop2 - a number property of SpecialType.
 * this comment line will also be attached to prop2.
 * @property {number=} prop3 - an optional number property of SpecialType
 * @prop {number} [prop4] - an optional number property of SpecialType
 * @prop {number} [prop5=42] - an optional number property of SpecialType with default.
 * this comment line will also be attached to prop5.
 */
