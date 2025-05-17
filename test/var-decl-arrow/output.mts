const arrowFunction = (a: number, b: string): string => {
  return "foo";
};
const genericArrowFunction = <T extends Record<string, any>>(a: T, b: T) => {
  return "foo";
};

//==========================================

/**
 * @param {string} [a] - the first value.
 */
const withOptionalParam = (a?: string) => {
  return a;
};

/**
 * @param {string} [a] - the first value.
 */
const withOptionalParamAndDefault = (a: string = "default") => {
  return a;
};

//==========================================

/**
 * @param {string} a - the first value.
 */
const withExtraComments = (a: string, /** the other value. */ b: number) => {
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
  const inner = (): string => {
    return "foo";
  };
  const func: () => string | 0 = Math.random() > 0.5 ? inner : (): 0 => 0;
  return func();
}

//==========================================
export const exportedArrowFunction = (): string => {
  return "foo";
};
