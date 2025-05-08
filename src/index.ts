import { transformAsync, types, parseSync } from "@babel/core";
import { generate } from "@babel/generator";
import minimist from "minimist";
import * as fs from "node:fs";
import * as path from "node:path";
import * as CommentParser from "@es-joy/jsdoccomment";
import { inspect } from "node:util";

const debug = process.env.DEBUG ? console.error : undefined;

async function main() {
  const args = minimist(process.argv.slice(2));
  const [rawfilePath] = args._;

  const filePath = path.resolve(rawfilePath);
  const fileContents = fs.readFileSync(filePath, "utf8");

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
          // ExportDeclaration(path) {
          //   debug?.("ExportDeclaration", path.node.leadingComments);
          // },
          // FunctionDeclaration(path) {
          //   debug?.("FunctionDeclaration", path.node.leadingComments);
          // },
          VariableDeclaration(path) {
            if (path.node.leadingComments) {
              const typeAnnotationStr = extractSimpleTypeFromComments(
                path.node.leadingComments
              );
              if (typeAnnotationStr) {
                // if there's multiple declarators, the type comment applies to the first one
                const firstDeclaration = path.get("declarations.0");
                const idPath = firstDeclaration.get("id");
                if (
                  (idPath.isIdentifier() || idPath.isPattern()) &&
                  !idPath.node.typeAnnotation
                ) {
                  idPath.node.typeAnnotation = types.tsTypeAnnotation(
                    parseAsType(typeAnnotationStr)
                  );
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
                const typeAnnotationStr = extractSimpleTypeFromComments(
                  path.node.leadingComments
                );
                if (typeAnnotationStr) {
                  idPath.node.typeAnnotation = types.tsTypeAnnotation(
                    parseAsType(typeAnnotationStr)
                  );
                }
              }
            }
          },
          ParenthesizedExpression(path) {
            // cast: `/** @type {Foo} */ (foo)`
            debug?.("ParenthesizedExpression", path.node.leadingComments);
            if (path.node.leadingComments) {
              const typeAnnotationStr = extractSimpleTypeFromComments(
                path.node.leadingComments
              );
              if (typeAnnotationStr) {
                path.replaceWith(
                  types.tsAsExpression(
                    path.node.expression,
                    parseAsType(typeAnnotationStr)
                  )
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

function extractSimpleTypeFromComments(comments: types.Comment[] | undefined) {
  if (!comments) return undefined;
  let typeAnnotationStr: string | undefined;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.type === "CommentBlock" && !typeAnnotationStr) {
      const parsed = CommentParser.parseComment(comment);
      const [maybeTypeComment, rest] = pickFirst(
        parsed.tags,
        (tag) => tag.tag === "type"
      );
      if (maybeTypeComment) {
        typeAnnotationStr = maybeTypeComment.type;
        if (rest.length === 0) {
          comments[i].ignore = true;
        } else {
          parsed.tags = rest;
          comment.value = CommentParser.estreeToString(
            CommentParser.commentParserToESTree(parsed, "jsdoc", {
              throwOnTypeParsingErrors: false,
            })
          );
        }
      }
    }
  }
  return typeAnnotationStr;
}

function parseAsType(typeStr: string) {
  const ast = parseSync(`type Dummy = (${typeStr});`, {
    ast: true,
    presets: ["@babel/preset-typescript"],
    filename: "anonymous.ts",
  });
  if (!ast) {
    throw new Error(`Failed to parse type \`${typeStr}\``);
  }
  const stmt = ast.program.body[0];
  types.assertTSTypeAliasDeclaration(stmt);
  types.assertTSParenthesizedType(stmt.typeAnnotation);
  return stmt.typeAnnotation.typeAnnotation;
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
