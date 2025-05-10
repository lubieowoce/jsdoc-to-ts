import { transformAsync, types, parseSync, type NodePath } from "@babel/core";
import { generate } from "@babel/generator";
import minimist from "minimist";
import * as fs from "node:fs";
import * as path from "node:path";
import * as CommentParser from "@es-joy/jsdoccomment";
import { stringify as stringifyComment } from "comment-parser";
import {
  templateTagContentsParser,
  typedefTagContentsParser,
} from "./parse-tag.ts";
import { findTagSourceLine, getTagContentsFromRawSource } from "./utils.ts";
import { inspect } from "node:util";

const debug = process.env.DEBUG ? console.error : undefined;
const parseBoolish = (value: string) => {
  if (!value || value === "0" || value === "false") return false;
  return true;
};
const EXPORT_TYPEDEFS =
  process.env.EXPORT_TYPEDEFS !== undefined
    ? parseBoolish(process.env.EXPORT_TYPEDEFS)
    : true;

async function main() {
  const args = minimist(process.argv.slice(2));
  const [rawfilePath] = args._;

  const filePath = path.resolve(rawfilePath);
  const fileContents = fs.readFileSync(filePath, "utf8");

  // TODO: to properly handle things like @typedef, we probably need to categorize JSDoc annotations:
  // - `@typedef {Ty} TypeName` - standalone
  //   - can contain `@template`
  //   - `@prop[erty] {Ty} name` - applies to the preceding @typedef if it's `@typedef {Object|object} Foo`
  // - `@import {TypeName} from "specifier"` - standalone (https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html#import)
  // standalone comments can get attached to random statements
  //
  // applies to the adjacent declaration:
  //   - `@type {Ty}`
  //     - unless it's in expression position, then it's a cast
  //   - `@satisfies {Ty}`
  //   - `@template ...`
  //
  // applies to the adjacent function declaration (or [arrow] function assignment / method / constructor):
  //   - `@returns {Ty}`
  //   - `@this {Ty}` - applies to the adjacent function declaration (or [arrow] function assignment)
  //   - `@param {Ty} name` - applies to the adjacent function declaration (or [arrow] function assignment)
  //     - `@prop[erty] {Ty} name` - applies to the preceding @param if it's `@param {Object|object} Foo`
  // applies to the adjacent class definition
  //   - `@extends {Base<T>}`
  //   - `@implements {SomeInterface}`

  const result = await transformAsync(fileContents, {
    ast: true,
    filename: filePath,
    parserOpts: {
      // we need this for `/** @type {...} (EXPR) */` casts
      createParenthesizedExpressions: true,
    },
    plugins: [
      {
        name: "jsdoc-to-ts",
        visitor: {
          // TODO: annotated assignments, e.g. module.exports
          // TODO: `@import` -> `import type`
          // ExportDeclaration(path) {
          //   debug?.("ExportDeclaration", path.node.leadingComments);
          // },
          // Declaration(path) {},
          FunctionDeclaration(path) {
            if (!path.node.leadingComments) return;

            for (const comment of path.node.leadingComments) {
              if (comment.ignore) continue;
              if (comment.type !== "CommentBlock") continue;

              // if we can't parse the JSDoc comment, warn and continue.
              let parsedJsdoc: ReturnType<typeof CommentParser.parseComment>;
              try {
                parsedJsdoc = CommentParser.parseComment(comment);
              } catch (err) {
                console.error("Failed to parse JSDoc comment", comment.value);
                return;
              }
              if (!parsedJsdoc.tags.length) continue;

              // @template
              (() => {
                const [templateTypeParams, takeUsedLines] = parseTemplateTags(
                  comment,
                  parsedJsdoc
                );
                if (!templateTypeParams.length) {
                  return null;
                }
                takeUsedLines();
                path.node.typeParameters =
                  types.tsTypeParameterDeclaration(templateTypeParams);
              })();

              // @returns
              const returnType = (() => {
                const returnsTag = parsedJsdoc.tags.find(
                  (tag) => tag.tag === "returns"
                );
                if (!returnsTag) return null;

                let returnType: types.TSType;
                try {
                  returnType = parseAsType(returnsTag.type);
                } catch (err) {
                  console.error(
                    "Failed to parse type in @returns tag\n:" + comment.value
                  );
                  return null;
                }
                // if there's a description, keep the tag.
                if (!isNonEmptyDescription(returnsTag.description)) {
                  stripUsedLinesFromComment(comment, parsedJsdoc, [returnsTag]);
                }
                return returnType;
              })();
              if (returnType) {
                path.node.returnType = types.tsTypeAnnotation(returnType);
              }

              // @param and inline @type
              (() => {
                const paramTags = parsedJsdoc.tags.filter(
                  (tag) => tag.tag === "param"
                );

                const usedLines: typeof paramTags = [];

                const paramTagsByName = new Map(
                  paramTags
                    .filter((paramTag) => !isNestedParamName(paramTag.name))
                    .map((paramTag) => [paramTag.name, paramTag] as const)
                );

                const [nestedParams, takeNestedParamLines] =
                  parseNestedParamDeclarations(comment, parsedJsdoc);

                for (const paramPath of path.get("params")) {
                  const paramLhs = paramPath.isAssignmentPattern()
                    ? paramPath.get("left")
                    : paramPath;
                  const paramIdent = paramLhs.isIdentifier() ? paramLhs : null;

                  // TODO: warn if we get both @type and @param
                  let paramType: types.TSType | null = null;
                  if (paramIdent) {
                    const paramName = paramIdent.node.name;
                    const tagForParam = paramTagsByName.get(paramName);
                    if (tagForParam) {
                      let paramTypeFromParamTag: types.TSType;
                      try {
                        paramTypeFromParamTag = parseAsType(tagForParam.type);
                      } catch (err) {
                        console.error(
                          "Failed to parse type in @param tag:\n" +
                            comment.value
                        );
                        return null;
                      }

                      // if we have some nested `@param {...} paramName.prop` declarations for this param,
                      // replace the param's type with the object they describe.
                      const nested = nestedParams?.get(paramName);
                      if (nested) {
                        if (
                          !canTypeHaveNestedProperties(paramTypeFromParamTag)
                        ) {
                          console.error(
                            `a \`@param\` with nested \`@param\` declarations must be of type \`object\` or \`Object\` t\n` +
                              comment.value
                          );
                          return null;
                        }
                        paramTypeFromParamTag = types.tsTypeLiteral(nested);
                      }

                      if (
                        tagForParam.optional &&
                        // if the param is assigned a default value, it shouldn't have a `?`
                        !paramPath.isAssignmentPattern()
                      ) {
                        paramPath.node.optional = true;
                      }

                      // if there's a description or a default annotation, keep the tag.
                      // TODO: replace the tag with a type-less @param instead
                      if (
                        !isNonEmptyDescription(tagForParam.description) &&
                        !tagForParam.default
                      ) {
                        usedLines.push(tagForParam);
                      } else {
                        debug?.(tagForParam);
                      }
                      paramType = paramTypeFromParamTag;
                    }
                  }
                  // if we didn't get anything from `@param` tags on the function definition, try inline `@type` on the parameter itself.
                  if (!paramType) {
                    paramType = extractSimpleTypeFromComments(
                      paramPath.node.leadingComments
                    );
                  }

                  if (paramType) {
                    const node = paramLhs.node;
                    if (
                      // these shouldn't be syntactically valid in a param, but otherwise TS complains
                      !types.isMemberExpression(node) &&
                      !types.isTSNonNullExpression(node)
                    ) {
                      node.typeAnnotation = types.tsTypeAnnotation(paramType);
                    }
                  }
                }
                takeNestedParamLines();
                stripUsedLinesFromComment(comment, parsedJsdoc, usedLines);
              })();
            }
          },

          Statement(path) {
            if (!path.node.leadingComments) return;

            for (const comment of path.node.leadingComments) {
              if (comment.ignore) continue;
              if (comment.type === "CommentLine") {
                // remove '@ts-check' comments -- we're converting to typescript, so they're redundant.
                if (/\s*@ts-check\s*/.test(comment.value)) {
                  comment.ignore = true;
                  continue;
                }
              } else {
                // check for JSDoc tags that aren't handled by more specific visitors (i.e. not @type),
                // because they get attached to random statements that follow them.
                // if we can't parse the JSDoc comment, warn and continue.
                let parsedJsdoc: ReturnType<typeof CommentParser.parseComment>;
                try {
                  parsedJsdoc = CommentParser.parseComment(comment);
                } catch (err) {
                  console.error("Failed to parse JSDoc comment", comment.value);
                  return;
                }
                if (!parsedJsdoc.tags.length) continue;

                const decl = extractTypedef(comment, parsedJsdoc);
                if (!decl) continue;

                const [inserted] = path.insertBefore(
                  EXPORT_TYPEDEFS ? types.exportNamedDeclaration(decl) : decl
                );
                if (comment.value && !comment.ignore) {
                  comment.ignore = true;
                  inserted.addComment("leading", comment.value, false);
                }
              }
            }
          },

          VariableDeclaration(path) {
            if (path.node.leadingComments) {
              const typeAnnotation = extractSimpleTypeFromComments(
                path.node.leadingComments
              );
              if (typeAnnotation) {
                // if there's multiple declarators, the type comment applies to the first one
                const firstDeclaration = path.get("declarations.0");
                const idPath = firstDeclaration.get("id");
                if (
                  (idPath.isIdentifier() || idPath.isPattern()) &&
                  !idPath.node.typeAnnotation
                ) {
                  idPath.node.typeAnnotation =
                    types.tsTypeAnnotation(typeAnnotation);
                }
              }
            }
          },
          VariableDeclarator(path) {
            const idPath = path.get("id");
            if (
              (idPath.isIdentifier() || idPath.isPattern()) &&
              !idPath.node.typeAnnotation
            ) {
              if (path.node.leadingComments) {
                const typeAnnotation = extractSimpleTypeFromComments(
                  path.node.leadingComments
                );
                if (typeAnnotation) {
                  idPath.node.typeAnnotation =
                    types.tsTypeAnnotation(typeAnnotation);
                }
              }
            }
          },
          ParenthesizedExpression(path) {
            // cast: `/** @type {Foo} */ (foo)`
            debug?.("ParenthesizedExpression", path.node.leadingComments);
            if (path.node.leadingComments) {
              const typeAnnotation = extractSimpleTypeFromComments(
                path.node.leadingComments
              );
              if (typeAnnotation) {
                path.replaceWith(
                  types.tsAsExpression(path.node.expression, typeAnnotation)
                );
              }
            }
          },
        },
      },
    ],
  });
  let output = generate(result!.ast!).code;
  output = insertForcedLinebreaks(output);
  console.log(output);
}

function extractTypedef(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): types.TSTypeAliasDeclaration | null {
  const [typeParams, takeTypeParamLines] = parseTemplateTags(
    comment,
    parsedJsdoc
  );

  const typeDef = parsedJsdoc.tags.find((tag) => tag.tag === "typedef");
  if (!typeDef) return null;
  const sourceLine = findTagSourceLine(typeDef.source, "typedef")!;
  const typedefContents = getTagContentsFromRawSource(
    sourceLine?.source,
    "typedef"
  )!;
  const typedefParseResult = typedefTagContentsParser.parse(typedefContents);
  if (!typedefParseResult.status) {
    console.error("Failed to parse typedef:\n" + typedefContents);
    return null;
  }

  // TODO: map parse error to source location (in comment), e.g. by passing `parserOptions.startIndex`
  const typedefParsedToStr = typedefParseResult.value;
  const [lhs, typeParamsFromLhs] = parseAsTypeDeclarationLhs(
    typedefParsedToStr.lhs
  );
  let rhs = parseAsType(typedefParsedToStr.rhs);

  const [propertyDefs, takePropertyDefsLines] = parsePropertyDeclarations(
    comment,
    parsedJsdoc
  );
  if (propertyDefs.length) {
    // `@property` defs are only valid if the type is `object` or `Object`
    if (!canTypeHaveNestedProperties(rhs)) {
      console.error(
        `@typedef type must be \`object\` or \`Object\` when using @prop/@property\n` +
          comment.value
      );
      return null;
    }

    rhs = types.tsTypeLiteral(propertyDefs);
  }

  const decl = types.tsTypeAliasDeclaration(lhs, typeParamsFromLhs, rhs);

  if (!decl.typeParameters?.params?.length && typeParams.length) {
    console.error("Found `@template` declarations not used in type definition");
    return null;
  }
  if (decl.typeParameters?.params?.length && !typeParams.length) {
    console.error(
      "Type definition has params, but no `@template` declarations were found"
    );
    return null;
  }
  if (decl.typeParameters?.params) {
    const params = decl.typeParameters.params;
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const paramFromTemplate = typeParams.find((p) => p.name === param.name);
      if (!paramFromTemplate) {
        console.error(
          `Type definition uses type param ${param.name} with no matching \`@template\` declaration:\n` +
            comment.value
        );
        return null;
      }
      param.constraint = paramFromTemplate.constraint;
      param.default = paramFromTemplate.default;
      param.leadingComments = paramFromTemplate.leadingComments;
    }
  }

  // TODO: replace @typedef line with description comment if present
  takeTypeParamLines();
  takePropertyDefsLines();
  stripUsedLinesFromComment(comment, parsedJsdoc, [typeDef]);

  return decl;
}

function canTypeHaveNestedProperties(type: types.TSType) {
  // `@property` defs are only valid if the type is `object` or `Object`
  return (
    types.isTSObjectKeyword(type) ||
    (types.isTSTypeReference(type) &&
      types.isIdentifier(type.typeName) &&
      type.typeName.name === "Object")
  );
}

function parsePropertyDeclarations(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): [types.TSPropertySignature[], () => void] {
  const propTags = parsedJsdoc.tags.filter(
    (tag) => tag.tag === "property" || tag.tag === "prop"
  );
  const usedLines: typeof propTags = [];

  try {
    const propDefs = propTags.map((propTag) => {
      const propDef = createPropertyDeclaration(
        propTag.name,
        propTag.type,
        propTag.optional,
        propTag.description
      );
      usedLines.push(propTag);
      return propDef;
    });
    const takeUsedLines = () =>
      stripUsedLinesFromComment(comment, parsedJsdoc, usedLines);
    return [propDefs, takeUsedLines] as const;
  } catch (err) {
    console.error(
      new Error(
        "Failed to parse types in @prop/@property tag:\n" + comment.value,
        {
          cause: err,
        }
      )
    );
    return [[], () => {}] as const;
  }
}

function isNestedParamName(name: string) {
  return name.includes(".");
}

function parseNestedParamDeclarations(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): [Map<string, types.TSPropertySignature[]>, () => void] | [null, () => void] {
  const paramTags = parsedJsdoc.tags.filter(
    (tag) => tag.tag === "param" && isNestedParamName(tag.name)
  );
  const usedLines: typeof paramTags = [];

  const nestedParams = new Map<string, types.TSPropertySignature[]>();

  try {
    for (const paramTag of paramTags) {
      const [paramName, propName, ...rest] = paramTag.name.split(".");
      if (rest.length > 0) {
        console.error(
          "Not implemented - multiple levels of @param nesting:\n" +
            comment.value
        );
        return [null, () => {}];
      }
      let arr = nestedParams.get(paramName);
      if (!arr) {
        nestedParams.set(paramName, (arr = []));
      }
      const propDef = createPropertyDeclaration(
        propName,
        paramTag.type,
        paramTag.optional,
        paramTag.description
      );
      usedLines.push(paramTag);
      arr.push(propDef);
    }
    const takeUsedLines = () =>
      stripUsedLinesFromComment(comment, parsedJsdoc, usedLines);
    return [nestedParams, takeUsedLines] as const;
  } catch (err) {
    console.error(
      new Error(`Failed to parse types in @param tag:\n` + comment.value, {
        cause: err,
      })
    );
    return [null, () => {}];
  }
}

function createPropertyDeclaration(
  name: string,
  rawType: string,
  optional: boolean,
  description: string | undefined
) {
  // commentparser doesn't handle `@property {number=} foo`
  {
    // (but it does handle `@property {number=DEFAULT_VALUE} foo`)
    const match = rawType.match(/^(.*?)\s*=\s*$/);
    if (match) {
      rawType = match[1];
      optional = true;
    }
  }

  const propDef = types.tSPropertySignature(
    types.identifier(name),
    types.tsTypeAnnotation(parseAsType(rawType))
  );
  if (optional) {
    propDef.optional = true;
  }
  if (description && isNonEmptyDescription(description)) {
    addLeadingCommentWithForcedLinebreak(
      propDef,
      cleanDescriptionFromComment(description)
    );
  }
  return propDef;
}

function isNonEmptyDescription(description: string) {
  return !!description && !WHITESPACE_OR_EMPTY.test(description);
}
const WHITESPACE_OR_EMPTY = /^\s*$/;

const FORCED_LINEBREAK_MARKER = "__JSDOC_TO_TS_FORCE_LINEBREAK__";
const FORCED_LINEBREAK_MARKER_COMMENT_PATTERN = new RegExp(
  String.raw`[ \t]*//${FORCED_LINEBREAK_MARKER}\n`,
  "g"
);

function addLeadingCommentWithForcedLinebreak(node: types.Node, value: string) {
  types.addComment(node, "leading", FORCED_LINEBREAK_MARKER, true);
  types.addComment(node, "leading", value, false);
}

function insertForcedLinebreaks(code: string) {
  // using a line comment already forced a line break, so we can strip the line itself.
  return code.replaceAll(FORCED_LINEBREAK_MARKER_COMMENT_PATTERN, "");
}

function parseTemplateTags(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): [typeParams: types.TSTypeParameter[], takeUsedLines: () => void] {
  // @template T, U, V        // <T, U, V>
  // @template {Ext} T        // <T extends Ext>
  // @template [T=Def]        // <T = Def>
  // @template {Ext} [T=Def]  // <T extends Ext = Def>
  const templateTags = parsedJsdoc.tags.filter((tag) => tag.tag === "template");
  const usedLines: typeof templateTags = [];
  const typeParams = templateTags.flatMap((tag) => {
    const rawTagSource = tag.source.find((src) =>
      src.source.includes("@template ")
    )!.source;
    const tagSource = getTagContentsFromRawSource(rawTagSource, "template")!;

    // NOTE: a @template tags can contain random comments after the identifier,
    // but our parser ignores that
    const parsedToStr = templateTagContentsParser.parse(tagSource);
    if (!parsedToStr.status) {
      console.error(
        "Failed to parse @template tag:\n  " +
          tagSource +
          "\n" +
          `(parse error: Expected one of ${inspect(
            parsedToStr.expected
          )} at ${inspect(parsedToStr.index)})`
      );
      return [];
    }

    try {
      const params = parsedToStr.value.map((res) => {
        const node = types.tsTypeParameter(
          // TODO: map parse error to source location (in comment), e.g. by passing `parserOptions.startIndex`
          res.constraint ? parseAsType(res.constraint) : null,
          res.default ? parseAsType(res.default) : null,
          res.name
        );
        if (res.comment) {
          addLeadingCommentWithForcedLinebreak(
            node,
            cleanDescriptionFromComment(res.comment)
          );
        }
        usedLines.push(tag);
        return node;
      });

      return params;
    } catch (err) {
      console.error(
        new Error("Failed to parse types in @template tag:\n" + tagSource, {
          cause: err,
        })
      );
    }
    return [];
  });
  const takeUsedLines = () =>
    stripUsedLinesFromComment(comment, parsedJsdoc, usedLines);
  return [typeParams, takeUsedLines];
}

function cleanDescriptionFromComment(comment: string) {
  // clean up serparators between type param and comment
  // (not syntactically necessary, but not uncommon)
  if (
    comment.startsWith(": ") ||
    comment.startsWith("- ") ||
    comment.startsWith(", ")
  ) {
    comment = comment.slice(2).trim();
  }

  return formatTextAsJsDoc(comment);
}

function formatTextAsJsDoc(text: string) {
  if (!text) return text;
  const lines = text.split("\n");
  if (lines.length === 1) {
    return `* ${text.trim()} `;
  } else {
    ensureLastJsdocLineIsEmpty(lines);
    return lines
      .map((line, i, lines) =>
        // if we have multiple lines, the last one should be `*/`.
        // we've already normalized the line to be empty, so we can just skip it.
        i === lines.length - 1 ? line : "* " + line
      )
      .join("\n");
  }
}

function extractSimpleTypeFromComments(
  comments: types.Comment[] | null | undefined
): types.TSType | null {
  if (!comments) return null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.type !== "CommentBlock" || comment.ignore) continue;

    // if we can't parse the JSDoc comment, warn and continue.
    let parsedJsdoc: ReturnType<typeof CommentParser.parseComment>;
    try {
      parsedJsdoc = CommentParser.parseComment(comment);
    } catch (err) {
      console.error("Failed to parse JSDoc comment", comment.value);
      return null;
    }

    if (!parsedJsdoc.tags.length) continue;

    const typeTag = parsedJsdoc.tags.find((tag) => tag.tag === "type");
    if (!typeTag) continue;

    // TODO: map parse error to source location (in comment), e.g. by passing `parserOptions.startIndex`
    let typeAnnotation: types.TSType;
    try {
      typeAnnotation = parseAsType(typeTag.type);
    } catch (err) {
      // if we failed to parse this type annotation, bail out.
      console.error(err);
      return null;
    }

    // strip the @type comment
    stripUsedLinesFromComment(comment, parsedJsdoc, [typeTag]);
    // if there was a description, preserve it.
    if (isNonEmptyDescription(typeTag.description)) {
      comment.ignore = false;
      comment.value = cleanDescriptionFromComment(typeTag.description);
    }

    // TODO: warn about multiple @type annotations
    return typeAnnotation;
  }
  return null;
}

function stripUsedLinesFromComment(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline,
  usedLines: CommentParser.JsdocTagWithInline[]
) {
  // TODO: this removes text lines that occur after tags (which the parser doesn't consider part of `description`),
  // maybe we can be smarter about this by checking if all source lines got filtered out?
  parsedJsdoc.tags = parsedJsdoc.tags.filter((tag) => !usedLines.includes(tag));
  const removedLineNumbers = new Set(
    usedLines.flatMap((usedLine) =>
      usedLine.source.map((sourceLine) => sourceLine.number)
    )
  );
  parsedJsdoc.source = parsedJsdoc.source.filter(
    (srcLine) => !removedLineNumbers.has(srcLine.number)
  );
  if (
    parsedJsdoc.tags.length === 0 &&
    (parsedJsdoc.source.length === 0 ||
      (parsedJsdoc.source.length === 1 &&
        parsedJsdoc.source[0].source === "/**"))
  ) {
    comment.ignore = true;
    comment.value = "";
    return;
  }

  let newCommentStr = stringifyComment(parsedJsdoc);

  // remove leading '/*', babel will add that
  const blockCommentStart = "/*";
  const blockCommentEnd = "*/";
  if (newCommentStr.startsWith(blockCommentStart)) {
    newCommentStr = newCommentStr.slice(blockCommentStart.length);
  }
  if (newCommentStr.endsWith(blockCommentEnd)) {
    newCommentStr = newCommentStr.slice(0, -blockCommentEnd.length);
  }

  // multi-line comments should end with an empty line.
  if (newCommentStr.includes("\n")) {
    const lines = newCommentStr.split("\n");
    ensureLastJsdocLineIsEmpty(lines);
    newCommentStr = lines.join("\n");
  }
  comment.value = newCommentStr;
}

function ensureLastJsdocLineIsEmpty(lines: string[]) {
  const lastLine = lines[lines.length - 1];
  if (!/^[ \t]*\*?[ \t]*$/.test(lastLine)) {
    // if the last line isn't empty-ish, add an empty one.
    lines.push("");
  } else if (lastLine) {
    // if the last line is empty-ish but non-empty (e.g. it contains whitespace or a '*'), normalize it to be empty.
    lines[lines.length - 1] = "";
  }
}

function parseAsType(typeStr: string) {
  const decl = parseAsTypeDeclaration(`type Dummy = (${typeStr});`);
  types.assertTSParenthesizedType(decl.typeAnnotation);
  return decl.typeAnnotation.typeAnnotation;
}

function parseAsTypeDeclarationLhs(source: string) {
  const decl = parseAsTypeDeclaration(`type ${source} = any;`);
  return [decl.id, decl.typeParameters] as const;
}

function parseAsTypeDeclaration(source: string) {
  const ast = parseSync(source, {
    ast: true,
    presets: ["@babel/preset-typescript"],
    filename: "anonymous.ts",
  });
  if (!ast) {
    throw new Error(`Failed to parse type declaration \`${source}\``);
  }
  const decl = ast.program.body[0];
  types.assertTSTypeAliasDeclaration(decl);
  return decl;
}

main();
