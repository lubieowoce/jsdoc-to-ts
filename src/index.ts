import { transformAsync, types, parseSync } from "@babel/core";
import { generate } from "@babel/generator";
import minimist from "minimist";
import * as fs from "node:fs";
import * as path from "node:path";
import * as CommentParser from "@es-joy/jsdoccomment";
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
          // FunctionDeclaration(path) {
          //   debug?.("FunctionDeclaration", path.node.leadingComments);
          //   path.node.typeParameters
          // },

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
  console.log(generate(result!.ast!).code);
}

function extractTypedef(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): types.TSTypeAliasDeclaration | null {
  const [typeParams, takeTypeParamLines] = parseTemplateTags(
    comment,
    parsedJsdoc
  );
  const [typeDef, rest] = pickFirst(
    parsedJsdoc.tags,
    (tag) => tag.tag === "typedef"
  );
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
  const rhs = parseAsType(typedefParsedToStr.rhs);
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
  takeTypeParamLines();
  stripUsedLinesFromComment(comment, parsedJsdoc, [typeDef]);
  return decl;
}

function parseTemplateTags(
  comment: types.Comment,
  parsedJsdoc: CommentParser.JsdocBlockWithInline
): [typeParams: types.TSTypeParameter[], takeUsedLines: () => void] {
  // @template T, U, V        // <T, U, V>
  // @template {Ext} T        // <T extends Ext>
  // @template [T=Def]        // <T = Def>
  // @template {Ext} [T=Def]  // <T extends Ext = Def>
  const [templateTags, rest] = pick(
    parsedJsdoc.tags,
    (tag) => tag.tag === "template"
  );
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
          let comment = res.comment;

          // clean up serparators between type param and comment
          // (not syntactically necessary, but not uncommon)
          if (
            comment.startsWith(": ") ||
            comment.startsWith("- ") ||
            comment.startsWith(", ")
          ) {
            comment = comment.slice(2).trim();
          }
          // pad the comment with whitespace to make it look nice.
          if (!comment.startsWith(" ")) {
            comment = " " + comment;
          }
          if (!comment.endsWith(" ")) {
            comment = comment + " ";
          }

          // we want this to read as a JSDoc comment.
          comment = "*" + comment;
          types.addComment(node, "leading", comment, false);
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

function extractSimpleTypeFromComments(comments: types.Comment[] | undefined) {
  if (!comments) return undefined;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.type !== "CommentBlock" || comment.ignore) continue;

    // if we can't parse the JSDoc comment, warn and continue.
    let parsedJsdoc: ReturnType<typeof CommentParser.parseComment>;
    try {
      parsedJsdoc = CommentParser.parseComment(comment);
    } catch (err) {
      console.error("Failed to parse JSDoc comment", comment.value);
      return;
    }

    if (!parsedJsdoc.tags.length) continue;

    const [maybeTypeComment, rest] = pickFirst(
      parsedJsdoc.tags,
      (tag) => tag.tag === "type"
    );
    if (!maybeTypeComment) continue;

    // TODO: map parse error to source location (in comment), e.g. by passing `parserOptions.startIndex`
    let typeAnnotation: types.TSType;
    try {
      typeAnnotation = parseAsType(maybeTypeComment.type);
    } catch (err) {
      // if we failed to parse this type annotation, bail out.
      console.error(err);
      return undefined;
    }

    // strip the @type comment.
    stripUsedLinesFromComment(comment, parsedJsdoc, [maybeTypeComment]);
    // TODO: warn about multiple @type annotations
    return typeAnnotation;
  }
  return undefined;
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

  const asEstTree = CommentParser.commentParserToESTree(parsedJsdoc, "jsdoc", {
    throwOnTypeParsingErrors: false,
  });
  let newCommentStr = CommentParser.estreeToString(asEstTree, {
    preferRawType: true,
  });
  // remove leading '/*', babel will add that
  const blockCommentStart = "/*";
  const blockCommentEnd = "*/";
  if (newCommentStr.startsWith(blockCommentStart)) {
    newCommentStr = newCommentStr.slice(blockCommentStart.length);
  }
  if (newCommentStr.endsWith(blockCommentEnd)) {
    newCommentStr = newCommentStr.slice(0, -blockCommentEnd.length);
  }
  comment.value = newCommentStr;
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

function pickFirst<T>(
  arr: T[],
  pred: (value: T) => boolean
): [yes: T | undefined, no: T[]] {
  let matched = false;
  const predOnce = (value: T) => {
    if (matched) return false;
    matched = pred(value);
    return matched;
  };
  const [yes, no] = pick(arr, predOnce);
  return [yes[0], no];
}

function pick<T>(arr: T[], pred: (value: T) => boolean): [yes: T[], no: T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const value of arr) {
    if (pred(value)) {
      yes.push(value);
    } else {
      no.push(value);
    }
  }
  return [yes, no];
}

main();
