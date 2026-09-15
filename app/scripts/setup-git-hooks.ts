/**
 * Git Hooks 安装脚本
 *
 * 安装 pre-commit 钩子到 .git/hooks/，提交前自动运行架构合规检查。
 * 用法: bun run modules:setup
 *
 * 对应 .trae/rules/architecture-compliance.md G1 门禁
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 查找 .git 目录（从 app/scripts/ 向上搜索）
 */
function findGitDir(): string | null {
  const searchPaths = [
    join(__dirname, '..', '..', '.git'),    // 项目根目录
    join(__dirname, '..', '.git'),            // app 目录
  ];
  for (const p of searchPaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 安装 pre-commit 钩子
 */
function installPreCommitHook(gitDir: string): void {
  const hooksDir = join(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, 'pre-commit');

  // 检测运行环境：优先 bun，其次 node
  const hookContent = `#!/bin/sh
# Liri pre-commit hook — 提交前自动验证架构合规性
# 由 scripts/setup-git-hooks.ts 自动生成

echo "🔍 运行提交前检查 (G1门禁)..."

# 切换到项目根目录
PROJECT_DIR="$(git rev-parse --show-toplevel)"
cd "$PROJECT_DIR" || exit 1

# 检测运行时
if command -v bun > /dev/null 2>&1; then
  RUNNER="bun run"
elif command -v node > /dev/null 2>&1; then
  RUNNER="node"
else
  echo "⚠️ 未找到 bun 或 node，跳过检查"
  exit 0
fi

# ── 架构合规检查 ──
if [ -f "scripts/lint-architecture.ts" ]; then
  echo "  检查架构合规..."
  $RUNNER scripts/lint-architecture.ts
  RESULT=$?
  if [ $RESULT -ne 0 ] && [ $RESULT -ne 2 ]; then
    echo ""
    echo "❌ 架构合规检查失败！提交已阻止。"
    echo "   请修复上述违规后重新提交。"
    echo "   检查规则: .trae/rules/architecture-compliance.md"
    exit 1
  fi
fi

# ── 进入 app 目录验证 ──
cd "$PROJECT_DIR/app" || exit 0

# ── 类型检查（仅检查语法） ──
if [ -f "tsconfig.json" ]; then
  echo "  运行类型检查..."
  bun run typecheck 2>/dev/null || echo "  ⚠️ 类型检查有警告（不阻止提交）"
fi

# ── ESLint ──
if grep -q '"lint"' package.json 2>/dev/null; then
  echo "  运行 ESLint..."
  bun run lint --fix
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ ESLint 检查失败！提交已阻止。"
    echo "   请运行: cd app && bun run lint:fix"
    exit 1
  fi
fi

# ── 模块依赖验证（如果存在） ──
if grep -q '"modules:validate"' package.json 2>/dev/null; then
  echo "  验证模块依赖..."
  bun run modules:validate 2>/dev/null || echo "  ⚠️ 模块验证有警告"
fi

echo "✅ 提交前检查通过"
exit 0
`;

  writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log(`✅ pre-commit 钩子已安装: ${hookPath}`);
  console.log('   提交前自动运行: 架构合规检查 + 类型检查 + ESLint + 模块验证');
}

/*
 * 大瓦特（dawate）匹配模式（与 project_rules.md §1.1.1 一致，仅扫描代码文件）。
 * 注意：正则内联进 shell 单引号必须用 shell 安全转义（['\''"] 表示一个引号字符）
 * 以闭合单引号，避免与 grep 的 -E 正则冲突。见下方 installPrePushHook 模板内联处。
 */
const DAWATE_EXCLUDE = "\\.md$|scripts/lint-architecture\\.ts$";
/** git empty tree OID（新建分支 diff 基线） */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * 安装 pre-push 钩子 —— 禁止大瓦特（dawate）推送到外部公共仓库
 */
function installPrePushHook(gitDir: string): void {
  const hooksDir = join(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, 'pre-push');
  const hookContent = `#!/bin/sh
# Liri pre-push hook — 严禁大瓦特（dawate）推送至外部公共仓库
# 由 scripts/setup-git-hooks.ts 自动生成
# 规则: .trae/rules/project_rules.md §1.1.1

echo "🔍 推送前检查（大瓦特拦截）..."
EXT="${DAWATE_EXCLUDE}"
EMPTY=${EMPTY_TREE}

while read LOCAL_REF LOCAL_OID REMOTE_REF REMOTE_OID; do
  [ -z "$LOCAL_REF" ] && continue
  [ "$REMOTE_REF" = "(delete)" ] && continue

  BASE="$REMOTE_OID"
  if [ "$REMOTE_OID" = "0000000000000000000000000000000000000000" ]; then
    BASE="$EMPTY"   # 新建分支：以空树为基线
  fi

  # 找出本次推送引入的候选文件（排除文档与合法 env 白名单文件）
  FILES="$(git diff --name-only "$BASE" "$LOCAL_OID" 2>/dev/null | grep -Ev "$EXT" || true)"
  [ -z "$FILES" ] && continue

  if ! printf '%s\\n' "$FILES" | while read -r F; do
    if git diff "$BASE" "$LOCAL_OID" -- "$F" 2>/dev/null | grep -qiE 'DawateProvider|dawate ?(Provider|provider)|dawate ?(智能体|私)|大瓦特|id[[:space:]]*[:=][[:space:]]*['\''"]dawate|['\''"]dawate['\''"]'; then
      echo ""
      echo "❌ 本推送含大瓦特（dawate）专有代码，违反 project_rules.md §1.1.1！"
      echo "   大瓦特允许提交到本地仓库，但严禁推送到外部公共仓库。推送已阻止。"
      exit 1
    fi
  done; then :; else
    exit 1
  fi
done

echo "✅ 推送前检查通过（未含大瓦特代码）"
exit 0
`;

  writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log(`✅ pre-push 钩子已安装: ${hookPath}`);
  console.log('   推送前自动运行: 大瓦特（dawate）拦截');
}

function main(): void {
  const gitDir = findGitDir();
  if (!gitDir) {
    console.log('⚠️  未找到 .git 目录，跳过钩子安装。');
    console.log('   初始化 git 仓库后运行: bun run modules:setup');
    return;
  }

  installPreCommitHook(gitDir);
  installPrePushHook(gitDir);
  console.log('✅ Git hooks 安装完成');
}

main();
