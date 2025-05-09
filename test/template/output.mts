export type KeyOf<T extends Record<string, any> = Record<string, any>> =
  keyof T;
/**
 * Beep boop, a description
 */
export type Foo1 = KeyOf;
export type Foo2<A, B, C extends Record<string, any>, D = string> = [
  A,
  B,
  C,
  D,
];
export type Foo3<A, B, C extends Record<string, any>, D = string> = [
  A,
  B,
  C,
  D,
];
export type Foo4<
  /** TrailingCommentA (with some more stuff here) */ A,
  /** some comments for B. */ B,
  C extends Record<string, any>,
  /** TrailingCommentD (with some more stuff here) */ D = string,
> = [A, B, C, D];
const foo: string | null = null;
