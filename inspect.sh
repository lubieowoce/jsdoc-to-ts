#!/usr/bin/env bash
set -eu -o pipefail
input_file="${1-}"
if ! [ -f "$input_file" ]; then
  echo "Input file '$input_file' does not exist" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
tmp_file="$tmp_dir/output.mts"

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  src/index.ts "$input_file" > "$tmp_file"

pnpm prettier --write "$tmp_file" --log-level=error

# shellcheck disable=SC2209
cat_tool=cat
if which bat > /dev/null; then
  cat_tool='bat'
fi

$cat_tool "$tmp_file"
