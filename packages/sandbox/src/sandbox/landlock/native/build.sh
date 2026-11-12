#!/bin/sh
# 构建 landlock-run 静态二进制（需 Linux 5.13+ 内核环境）
#
# 用法:
#   ./build.sh [output-path]      # 默认输出 ./landlock-run
#
# 验证:
#   ./landlock-run --probe        # 期望: landlock: fully enforced（或 partial）
set -eu

OUT="${1:-$(dirname "$0")/landlock-run}"
CC="${CC:-cc}"

"$CC" -static -O2 -Wall -Wextra -o "$OUT" "$(dirname "$0")/main.c"
echo "built: $OUT"
echo "verify: $OUT --probe"
