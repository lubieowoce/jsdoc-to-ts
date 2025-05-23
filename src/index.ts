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

  // HACK: babel strips whitespace. We want to preserve blank lines from the input,
  // so replace them with a marker comment (which we will remove at the end)
  // TODO: sourcemap this and pass as `inputSourceMap` to babel
  const source = markEmptyLines(fileContents);

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

  const result = await transformAsync(source, {
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
          // TODO: `@this`
          Block(path) {
            if (path.node.leadingComments) {
              handleFloatingComments(
                path.node.leadingComments,
                path,
                // leading floating comments belong to the parent block.
                path.isProgram() ? path : findBlockParent(path),
                (decl) => {
                  if (path.isProgram()) {
                    // this doesn't really happen:
                    // - if a program contains statements/declarations, comments will get attached to those
                    // - if it's empty, we'll get the comment in `innerComments` and handle them below
                    // but technically it'd make sense to do this, so we can have this codepath here
                    // in case babel changes behavior around this or something
                    path.unshiftContainer("body", decl);
                  } else {
                    // if the leading comments contain typedefs, we should insert those into the parent, not the block itself.
                    path.insertBefore(decl);
                  }
                }
              );
            }

            // a module (or block) can consist of only comments.
            // in that case, no other visitors will be triggered, so handle them here.
            if (path.node.innerComments) {
              handleFloatingComments(
                path.node.innerComments,
                path,
                path,
                (decl) => {
                  // use push to preserve insertion order.
                  path.pushContainer("body", decl);
                }
              );
            }

            // comments that occur after the last block item will be attached to it as trailing comments.
            // other visitors only look at leading comments, so we need to handle those.
            // (the above sections will insert type definitions before their items,
            //  so we know that this isn't a type declaration inserted by us)
            if (path.node.body.length > 0) {
              const lastIndex = path.node.body.length - 1;
              const lastPath = path.get(`body.${lastIndex}`);
              if (lastPath.node.trailingComments) {
                handleFloatingComments(
                  lastPath.node.trailingComments,
                  path,
                  path,
                  (decl) => {
                    path.pushContainer("body", decl);
                  }
                );
              }
            }
          },

          FunctionDeclaration(path) {
            // this seems to run before the floating-comments handler in `Statement`,
            // so we need to make sure we don't steal a @template from a @typedef
            const comments = resolveLeadingComments(path);
            if (comments) {
              handleFloatingComments(comments, path, findBlockParent(path));
            }
            handleFunction(path);
          },
          FunctionExpression(path) {
            // TODO: this might be incorrect for HOF wrappers like this:
            //   /** @returns {Blah} */
            //   const foo = wrap(() => ...)
            handleFunction(path);
          },
          ArrowFunctionExpression(path) {
            // TODO: this might be incorrect for HOF wrappers like this:
            //   /** @returns {Blah} */
            //   const foo = wrap(() => ...)
            handleFunction(path);
          },

          Statement(path) {
            const comments = resolveLeadingComments(path);
            if (!comments) return;
            handleFloatingComments(comments, path, findBlockParent(path));
          },

          VariableDeclaration(path) {
            const comments = resolveLeadingComments(path);
            if (!comments) return;

            const typeAnnotation = extractSimpleTypeFromComments(comments);
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

  // babel doesn't add a trailing newline. this can break our whitespace insertion logic,
  // because we're matching comments with a newline at the end.
  let output = generate(result!.ast!).code + "\n";

  output = insertForcedWhitespace(output);
  console.log(output);
}

function handleFunction(
  path: NodePath<
    | types.FunctionDeclaration
    | types.FunctionExpression
    | types.ArrowFunctionExpression
  >
) {
  // don't early return if there's no leading comments, we might have inline param comments
  const comments = resolveLeadingComments(path) ?? [];

  const cleanups: (() => void)[] = [];

  const paramTagsByName = new Map<
    string,
    {
      comment: types.CommentBlock;
      parsedJsdoc: CommentParser.JsdocBlockWithInline;
      tag: CommentParser.JsdocTagWithInline;
    }
  >();
  const nestedParams = new Map<string, types.TSPropertySignature[]>();

  for (const comment of comments) {
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
      cleanups.push(takeUsedLines);
      path.node.typeParameters =
        types.tsTypeParameterDeclaration(templateTypeParams);
    })();

    // @returns
    const returnType = (() => {
      const returnsTag = parsedJsdoc.tags.find((tag) => tag.tag === "returns");
      if (!returnsTag) return null;

      let returnType: types.TSType;
      try {
        returnType = parseAsType(returnsTag.type);
      } catch (err) {
        console.error(
          "Failed to parse type in @returns tag\n:" + comment.value
        );
        // TODO: trigger an early exit
        return null;
      }
      // if there's a description, keep the tag.
      if (!isNonEmptyDescription(returnsTag.description)) {
        cleanups.push(() =>
          stripUsedLinesFromComment(comment, parsedJsdoc, [returnsTag])
        );
      }
      return returnType;
    })();
    if (returnType) {
      path.node.returnType = types.tsTypeAnnotation(returnType);
    }

    // collect @param and inline @type
    {
      const paramTags = parsedJsdoc.tags.filter((tag) => tag.tag === "param");
      const usedLines: CommentParser.JsdocTagWithInline[] = [];

      for (const paramTag of paramTags) {
        if (!isNestedParamName(paramTag.name)) {
          paramTagsByName.set(paramTag.name, {
            comment,
            parsedJsdoc,
            tag: paramTag,
          });
        }
      }

      const [nestedParams_, takeNestedParamLines] =
        parseNestedParamDeclarations(comment, parsedJsdoc);
      if (nestedParams_) {
        for (const [paramName, decls] of nestedParams_) {
          nestedParams.set(paramName, decls);
        }
      }

      cleanups.push(() => {
        stripUsedLinesFromComment(comment, parsedJsdoc, usedLines);
        takeNestedParamLines();
      });
    }
  }

  // finalize types for params
  for (const paramPath of path.get("params")) {
    const paramLhs = paramPath.isAssignmentPattern()
      ? paramPath.get("left")
      : paramPath;
    const paramIdent = paramLhs.isIdentifier() ? paramLhs : null;

    // TODO: warn if we get both @type and @param
    let paramType: types.TSType | null = null;
    if (paramIdent) {
      const paramName = paramIdent.node.name;
      const entry = paramTagsByName.get(paramName);
      if (entry) {
        const usedLines: CommentParser.JsdocTagWithInline[] = [];
        const { tag: tagForParam, parsedJsdoc, comment } = entry;
        let paramTypeFromParamTag: types.TSType;
        try {
          paramTypeFromParamTag = parseAsType(tagForParam.type);
        } catch (err) {
          console.error(
            "Failed to parse type in @param tag:\n" + comment.value
          );
          return null;
        }

        // if we have some nested `@param {...} paramName.prop` declarations for this param,
        // replace the param's type with the object they describe.
        const nested = nestedParams?.get(paramName);
        if (nested) {
          if (!canTypeHaveNestedProperties(paramTypeFromParamTag)) {
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
          cleanups.push(() =>
            stripUsedLinesFromComment(comment, parsedJsdoc, [tagForParam])
          );
          usedLines.push(tagForParam);
        } else {
          debug?.("non-empty param description", tagForParam);
        }
        paramType = paramTypeFromParamTag;
      }
    }
    // if we didn't get anything from `@param` tags on the function definition, try inline `@type` on the parameter itself.
    if (!paramType) {
      paramType = extractSimpleTypeFromComments(paramPath.node.leadingComments);
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

  for (const cleanup of cleanups) {
    cleanup();
  }
}

/** Handles comments that might get attached to a node but don't apply to it. */
function handleFloatingComments(
  comments: types.Comment[],
  path: NodePath<types.Node>,
  container: NodePath<types.BlockParent>,
  insertDeclaration?: (decl: types.Declaration) => void
) {
  for (const comment of comments) {
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

      // we should only insert an export declaration for types defined at the top level.
      // types defined within a block should not be exported.
      const shouldAddExport = EXPORT_TYPEDEFS && container.isProgram();

      const fullDecl = shouldAddExport
        ? types.exportNamedDeclaration(decl)
        : decl;

      addTrailingEmptyLines(fullDecl);
      if (comment.value && !comment.ignore) {
        comment.ignore = true;
        types.addComment(fullDecl, "leading", comment.value, false);
      }
      addLeadingEmptyLines(fullDecl);

      if (insertDeclaration) {
        insertDeclaration(fullDecl);
      } else {
        path.insertBefore(fullDecl);
      }
    }
  }
}

function findBlockParent(path: NodePath<types.Node>) {
  // otherwise, we want to ignore the node itself.
  if (!path.parentPath) {
    throw new Error(
      "Invariant: Reached parent-less without finding a block parent"
    );
  }
  path = path.parentPath;

  while (!path.isBlockParent()) {
    if (!path.parentPath) {
      throw new Error(
        "Invariant: Reached parent-less without finding a block parent"
      );
    }
    path = path.parentPath;
  }
  return path;
}

function resolveLeadingComments(path: NodePath<types.Node>) {
  const enclosingDeclaration = findEnclosingDeclaration(path);
  return (
    path.node.leadingComments ?? enclosingDeclaration?.node.leadingComments
  );
}

function findEnclosingDeclaration(path: NodePath<types.Node>) {
  let parentPath: NodePath<types.Node> | null = path.parentPath;
  while (parentPath) {
    // we reached a block, so we're not enclosed in an export declaration.
    if (parentPath.isBlockParent()) {
      return null;
    }
    // we're enclosed in a declaration.
    // but if there's another declaration around it, we want to visit that (usually this is `export const ...`)
    if (parentPath.isDeclaration() && !parentPath.parentPath.isDeclaration()) {
      return parentPath;
    }
    parentPath = parentPath.parentPath;
  }
}

function extractTypedef(
  comment: types.CommentBlock,
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
  comment: types.CommentBlock,
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
  comment: types.CommentBlock,
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

const EMPTY_LINE_MARKER = "@__JSDOC_TO_TS_EMPTY_LINE__";
const FORCED_LINEBREAK_MARKER = "@__JSDOC_TO_TS_FORCE_LINEBREAK__";

function addLeadingCommentWithForcedLinebreak(node: types.Node, value: string) {
  types.addComment(node, "leading", FORCED_LINEBREAK_MARKER, true);
  types.addComment(node, "leading", value, false);
}

function markEmptyLines(source: string): string {
  // find empty lines (newlines with optional leading whitespace)
  // note the `m` multiline flag on the regex.
  const emptyLineComment = "//" + EMPTY_LINE_MARKER + "\n";
  return source.replaceAll(/(?<=^[ \t]*)\n/gm, emptyLineComment);
}

function createLineComment(value: string): types.Comment {
  return {
    type: "CommentLine",
    value: value,
  };
}

function addLeadingEmptyLines(node: types.Node, lines = 1) {
  node.leadingComments ??= [];
  node.leadingComments.unshift(
    // the first comment goes on the same line as the statement, so add an extra one.
    ...Array.from({ length: lines + 1 })
      .fill(null)
      .map(() => createLineComment(EMPTY_LINE_MARKER))
  );
}

function addTrailingEmptyLines(node: types.Node, lines = 1) {
  node.trailingComments ??= [];
  node.trailingComments.unshift(
    // the first comment goes on the same line as the statement, so add an extra one.
    ...Array.from({ length: lines + 1 })
      .fill(null)
      .map(() => createLineComment(EMPTY_LINE_MARKER))
  );
}

function insertForcedWhitespace(code: string) {
  return (
    code
      .replaceAll(new RegExp(String.raw`//${EMPTY_LINE_MARKER}\n`, "g"), "\n")
      // using a line comment already forced a line break, so we can strip the whole line.
      .replaceAll(
        new RegExp(String.raw`//${FORCED_LINEBREAK_MARKER}\n`, "g"),
        ""
      )
  );
}

function parseTemplateTags(
  comment: types.CommentBlock,
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
  comment: types.CommentBlock,
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
