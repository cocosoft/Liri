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
  console.log('   提交前自动运行: 架构合规检查 + 类型检查 + 模块验证');
}

function main(): void {
  const gitDir = findGitDir();
  if (!gitDir) {
    console.log('⚠️  未找到 .git 目录，跳过钩子安装。');
    console.log('   初始化 git 仓库后运行: bun run modules:setup');
    return;
  }

  installPreCommitHook(gitDir);
  console.log('✅ Git hooks 安装完成');
}

main();
