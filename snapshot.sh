#!/usr/bin/env bash
set -eu -o pipefail
input="${1-}"
if [ -d "$input" ]; then
  found="$(find "$input" -type f -name "input.mjs")"
  # shellcheck disable=SC2206
  IFS=$'\n' input_files=( $found )

  if [ "${#input_files[@]}" -eq 0 ]; then
    echo "No input files found in '$input'" >&2
    exit 1
  fi
else
  if ! [ -f "$input" ]; then
    echo "Input file '$input_file' does not exist" >&2
    exit 1
  fi
  input_files=( "$input" )
fi

echo "input files:" >&2
for input_file in "${input_files[@]}"; do
  echo "  $input_file" >&2
done
echo >&2

# shellcheck disable=SC2209
diff_tool=diff
custom_diff_tool="${DIFF_TOOL-}"
if [ -n "$custom_diff_tool" ]; then
  if which "$custom_diff_tool" > /dev/null; then
    diff_tool="$custom_diff_tool"
  else
    echo "custom diff tool '$custom_diff_tool' not found" >&2
    exit 1
  fi
else
  # use icdiff if it exists
  if which icdiff > /dev/null; then
    diff_tool='icdiff'
  fi
fi

snapshot_changed=''
should_update_snapshots="${UPDATE-0}"

text_red=$'\033[31m'
text_green=$'\033[32m'
text_blue=$'\033[94m'
text_reset=$'\033[0m'


for input_file in "${input_files[@]}"; do
  output_file="$(sed -E 's/input\.mjs$/output.mts/' <<< "$input_file" )"

  tmp_dir="$(mktemp -d)"
  tmp_file="$tmp_dir/output.mts"

  node --experimental-strip-types --disable-warning=ExperimentalWarning \
    src/index.ts "$input_file" > "$tmp_file"

  pnpm prettier --write "$tmp_file" --log-level=error

  if [ "${#input_files[@]}" -eq 1 ]; then
    cat "$tmp_file"
  fi

  if ! [ -f "$output_file" ]; then
    echo "${text_blue}[NEW]   ${text_reset} $output_file" >&2
    cp "$tmp_file" "$output_file"
  else
    if [ -n "$(diff --brief "$output_file" "$tmp_file")" ]; then
      if [ "$should_update_snapshots" = 1 ]; then
        echo "${text_blue}[UPDATE]${text_reset} $output_file" >&2
        cp "$tmp_file" "$output_file"
      else
        snapshot_changed=1
        if [ -s "$tmp_file" ]; then
          echo "" >&2
          echo "${text_red}[FAIL]  ${text_reset} ${output_file} changed (run with UPDATE=1 to update it)" >&2
          "$diff_tool" "$output_file" "$tmp_file" >&2 || true
        else
          # special case: avoid printing a whole diff if no output was generated
          echo "${text_red}[FAIL]  ${text_reset} $output_file: no output." >&2
        fi
      fi
    else
      echo "${text_green}[PASS]  ${text_reset} $output_file" >&2
    fi
  fi
done


if [ "$should_update_snapshots" = 0 ] && [ -n "$snapshot_changed" ]; then
  echo "${text_red}Some snapshots failed. (run with UPDATE=1 to update them)${text_reset}" >&2
  exit 1
fi
