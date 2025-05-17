const functionExpr = function (a: number, b: string): string {
  return "foo";
};
const genericFunctionExpr = function <T extends Record<string, any>>(
  a: T,
  b: T,
) {
  return "foo";
};

//==========================================

const onlyInlineTypes = function (a: string, b: number) {
  return a + b;
};

//==========================================

/**
 * @param {string} [a] - the first value.
 */
const withOptionalParam = function (a?: string) {
  return a;
};

/**
 * @param {string} [a] - the first value.
 */
const withOptionalParamAndDefault = function (a: string = "default") {
  return a;
};

//==========================================

/**
 * @param {string} a - the first value.
 */
const withExtraComments = function (
  a: string,
  /** the other value. */ b: number,
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
  const inner = function (): string {
    return "foo";
  };
  const func: () => string | 0 =
    Math.random() > 0.5
      ? inner
      : function (): 0 {
          return 0;
        };
  return func();
}

//==========================================
export const exportedFunction = function (): string {
  return "foo";
};
