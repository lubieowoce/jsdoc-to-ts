import P from "parsimmon";

const withNullProto = <TObj extends Record<string, any>>(values: TObj): TObj =>
  Object.assign(Object.create(null), values);

const openDelim = withNullProto({
  "{": "}",
  "[": "]",
  "(": ")",
  "<": ">",
} as const);
const closeDelim = withNullProto({
  "}": "{",
  "]": "[",
  ")": "(",
  ">": "<",
} as const);
type OpenDelim = keyof typeof openDelim;

function balanced(start: OpenDelim, includeDelims: boolean) {
  return P.custom<string>((success, failure) => (stream, startIndex) => {
    let i = startIndex;
    let len = stream.length;

    if (stream[startIndex] !== start) {
      return failure(
        startIndex,
        `Expected input to start with ${start}, got ${stream[startIndex]}`
      );
    }
    const stack: OpenDelim[] = [start];
    while (i++ < len) {
      const chr = stream[i];
      // open delimiter
      if (chr in openDelim) {
        stack.push(chr as OpenDelim);
        continue;
      }

      // close delimiter
      if (chr in closeDelim) {
        if (chr === ">" && i > 0 && stream[i - 1] === "=") {
          // arrow function, don't treat it as a closing delimiter
        }
        const stackTop = stack[stack.length - 1];
        const expectedStackTop = closeDelim[chr as keyof typeof closeDelim];
        if (stackTop !== expectedStackTop) {
          return failure(
            i,
            `Unbalanced delimiters: got ${chr} before ${stackTop} was closed (stack: ${JSON.stringify(
              stack
            )})`
          );
        }
        stack.pop();
        if (stack.length === 0) {
          // we balanced the initial delimiter
          const result = includeDelims
            ? stream.slice(startIndex, i + 1)
            : stream.slice(startIndex + 1, i);
          return success(i + 1, result);
        } else {
          continue;
        }
      }

      // non-delimiter
      continue;
    }
    // reached the end of the stream without returning
    const stackTop = stack[stack.length - 1];
    return failure(
      i,
      `Unbalanced delimiters: input ended before ${stackTop} was closed`
    );
  });
}

function withOptWhitespace<T>(parser: P.Parser<T>): P.Parser<T> {
  return parser.wrap(P.optWhitespace, P.optWhitespace);
}

const typeParamName = P.regex(/([a-zA-Z0-9_$]+)/, 0).desc("Type parameter");

const typeParamConstraint = balanced("{", false)
  .fallback(null)
  .desc("type parameter constraint");

// [T=DefaultType]
const typeParamWithDefault = balanced("[", false).chain((inner) => {
  const innerParser = P.seq(
    withOptWhitespace(typeParamName),
    P.string("="),
    P.regexp(/^\s*(.+?)\s*$/, 1)
  ).map<TemplateTagParam>(([name, , default_]) => ({
    name,
    default: default_,
    constraint: null,
    comment: null,
  }));
  const innerResult = innerParser.parse(inner);
  if (innerResult.status) {
    return P.succeed(innerResult.value);
  } else {
    // TODO: properly report match index, maybe via a custom `nested` combinator
    return P.fail(
      `Failed to match inner content: ${JSON.stringify(innerResult.expected)}`
    );
  }
});

type TemplateTagParam = {
  name: string;
  constraint: string | null;
  default: string | null;
  comment: string | null;
};

const templateTagTypeParam = P.seq(
  typeParamConstraint
    .skip(P.whitespace.desc("whitespace after constraint"))
    .fallback(null),
  alt(
    // param with default value
    typeParamWithDefault,
    // bare param
    typeParamName.map<TemplateTagParam>((name) => ({
      name,
      default: null,
      constraint: null,
      comment: null,
    }))
  )
).map<TemplateTagParam>(([constraint, typeParam]) => ({
  ...typeParam,
  constraint,
}));

/** A parser that returns a union of the result types of many parsers. */
type AltReturn<TParsers extends [...P.Parser<any>[]]> = TParsers extends []
  ? never
  : P.Parser<AltParams<TParsers>>;

/** Create a union of type parameters of all the parsers in the tuple. */
type AltParams<TParsers extends [...P.Parser<any>[]]> = TParsers extends [
  P.Parser<infer T>,
  ...infer Rest,
]
  ? T | (Rest extends [...P.Parser<any>[]] ? AltParams<Rest> : never)
  : never;

/* A typesafe version of `alt` */
function alt<TParsers extends [...P.Parser<any>[]]>(
  ...parsers: TParsers
): AltReturn<TParsers> {
  if (!parsers.length) {
    return P.fail("ampty alternative") as AltReturn<[]>;
  }
  return P.alt(...parsers) as AltReturn<TParsers>;
}

const templateTagTypeParamsWithOptionalComment = P.seq(
  P.sepBy1(templateTagTypeParam, P.optWhitespace.then(P.string(","))),
  P.whitespace
    .then(P.all)
    .fallback(null)
    .desc("trailing comment after type params")
).map(([params, trailingComment]) => {
  // if there's a trailing comment, attach to the last param.
  // (but if we have a comment, there's likely just one param, combining multiple params and a comment would be weird)
  if (trailingComment !== null) {
    params[params.length - 1].comment = trailingComment;
  }
  return params;
});

export const templateTagContentsParser =
  templateTagTypeParamsWithOptionalComment;

// TODO: can there be random comments after?
export const templateTagParser = withOptWhitespace(P.string(`@template`)).then(
  templateTagContentsParser
);

const typedefName = P.regex(/([a-zA-Z0-9_$]+)/, 0).desc("typedef identifier");
const typedefLhs = P.seq(typedefName, balanced("<", true).fallback(null))
  .map(([name, params]) => (params !== null ? name + params : name))
  .desc("typedef name");

export const typedefTagContentsParser = P.seq(
  balanced("{", false).desc("typedef type"),
  P.whitespace,
  typedefLhs
).map(([typeRhs, , typeLhs]) => ({
  lhs: typeLhs,
  rhs: typeRhs,
}));

// const debugParse = <T>(parser: P.Parser<T>, input: string) => {
//   const result = parser.parse(input);
//   if (!result.status) {
//     const ctxLen = 60;
//     const ctxStart = Math.max(0, result.index.offset - ctxLen);
//     const ctxEnd = result.index.offset + ctxLen;
//     const offsetInCtx = result.index.offset - ctxStart;
//     const lineWithCtx = input.slice(
//       Math.max(0, result.index.offset - ctxLen),
//       ctxEnd
//     );
//     console.error(
//       `Failed to parse at index ${result.index.offset} (input length: ${input.length})` +
//         "\n",
//       lineWithCtx +
//         (ctxEnd > input.length ? '"' : "") +
//         "\n" +
//         (" ".repeat(offsetInCtx + 1) + "^") +
//         "\n" +
//         "Expected: " +
//         JSON.stringify(result.expected) +
//         "\n" +
//         inspect(result)
//     );
//   } else {
//     console.log(result.value);
//   }
// };

// TODO: turn these into tests
// const complexType = `Record<string, [(...args: any[]) => void, {[key: string]: any}]>`;
// const test = `@template {{[key: string]: any}} [A={[key: string]: any}], B, {Ext} C, [D=Def]`;
// debugParse(
//   typeParamExtends,
//   `{Foobar} `
//   // `{${complexType}}` + "   "
// );

// debugParse(
//   typeParamExtends.skip(P.whitespace).skip(P.eof),
//   "{Record<string, [(...args: any[]) => void, {[key: string]: any}]>}" +
//     "   "
// );
// debugParse(P.regex(/a+/), "a".repeat(30) + "b" + "a".repeat(10));
// debugParse(parser, `{${complexType}} Abc, X , [Y=${complexType}]`);
// console.log(parser.parse(" A, {TODO} Bee , C1"));
