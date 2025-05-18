/**
 * This is a top level type
 */
export type Foo = Object;

{
  /**
   * No other statements
   *
   * This should not conflict with the outer Foo,
   * because it's defined in a block scope
   */
  type Foo = Object;
}

{
  /**
   * Leading comment
   *
   * This should not conflict with the outer Foo,
   * because it's defined in a block scope
   */
  type Foo = Object;

  const DUMMY = 1;
}

{
  const DUMMY = 1;

  /**
   * Trailing comment
   *
   * This should also not conflict with the outer Foo,
   * because it's defined in a block scope
   */
  type Foo = Object;
}

if (true) {
  /**
   * This should also not conflict with the outer Foo,
   * because it's defined in an if
   */
  type Foo = Object;
}

/**
 * A description line at the start.
 */
export type SpecialType = {
  /** a string property of SpecialType */
  prop1: string;
  /** a number property of SpecialType.
   * this comment line will also be attached to prop2.
   */
  prop2: number;
  /** an optional number property of SpecialType */
  prop3?: number;
  /** an optional number property of SpecialType */
  prop4?: number;
  /** an optional number property of SpecialType with default.
   * this comment line will also be attached to prop5.
   */
  prop5?: number;
};
