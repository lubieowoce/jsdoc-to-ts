export type Example = number;

function containsTypedef() {
  type NestedExample = string;

  const x: NestedExample = "foo";
  return x;
}
