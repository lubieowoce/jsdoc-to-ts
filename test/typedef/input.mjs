// @ts-check

/**
 * This is some kind of description
 * @typedef {Object} Foo - this is a trailing comment
 */
const DUMMY = 1;

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
const DUMMY2 = 1;
