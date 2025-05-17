function functionDeclaration(a: number, b: string): string {
  return "foo";
}
function genericFunctionDeclaration<T extends Record<string, any>>(a: T, b: T) {
  return "foo";
}

//==========================================

/**
 * @param {string} [a] - the first value.
 */
function withOptionalParam(a?: string) {
  return a;
}

/**
 * @param {string} [a] - the first value.
 */
function withOptionalParamAndDefault(a: string = "default") {
  return a;
}

//==========================================

/**
 * @param {string} a - the first value.
 */
function withExtraComments(a: string, /** the other value. */ b: number) {
  return "foo";
}

/**
 * @param a - the first value.
 * */
function withoutTypes(a, /** the other value. */ b) {
  return "foo";
}

//==========================================

/**
 * This function takes an object parameter defined via multiple at-param lines.
 */
function takesObject(
  arg: {
    one: Record<string, any>;
    /** a description for two */
    two?: number;
    three?: number;
    /** a description for four */
    four?: number;
  },
  more: string,
) {}

/**
 * This function takes an optional object parameter defined via multiple at-param lines.
 *
 * @param {object} [arg] a description for `arg`.
 */
function takesOptionalObject(
  more: string,
  arg?: {
    one: Record<string, any>;
    /** a description for two */
    two?: number;
    three?: number;
    /** a description for four */
    four?: number;
  },
) {}

//==========================================
export function exportedFunctionDeclaration(): string {
  return "foo";
}
