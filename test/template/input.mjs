// @ts-check

/**
 * @template {Record<string, any>} [T=Record<string, any>]
 * @typedef {keyof T} KeyOf<T>
 */

/**
 * Beep boop, a description
 * @typedef {KeyOf} Foo1
 * */

/**
 * @template A, B
 * @template {Record<string, any>} C, [D=string]
 * @typedef {[A, B, C, D]} Foo2<A, B, C, D>
 * */

/**
 * @template A  , B
 * @template {Record<string, any>}  C ,  [D=string]
 * @typedef {[A, B, C, D]} Foo3<A, B, C, D>
 * */

/**
 * @template A TrailingCommentA (with some more stuff here)
 * @template B some comments for B.
 * @template {Record<string, any>} C, [D=string] - TrailingCommentD (with some more stuff here)
 * @typedef {[A, B, C, D]} Foo4<A, B, C, D>
 * */

/** @type {string | null} */
const foo = null;
