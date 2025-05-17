/**
 * This is some kind of description
 */
export type Foo = Object;

const DUMMY = 1;
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

const DUMMY2 = 1;
