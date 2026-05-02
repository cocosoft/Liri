/**
 * Git Hooks 安装脚本
 * 在项目根目录的 .git/hooks/ 中安装 pre-commit 钩子
 * 每次提交前自动运行 modules:validate
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 查找 .git 目录
 */
function findGitDir(): string | null {
  const searchPaths = [
    join(__dirname, '..', '..', '.git'),
    join(__dirname, '..', '.git')
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

  const hookContent = `#!/bin/sh
# PY_APP pre-commit hook — 提交前自动验证模块依赖关系
# 由 scripts/setup-git-hooks.ts 自动生成

echo "🔍 运行模块依赖关系验证..."
cd "$(git rev-parse --show-toplevel)/backend" || { echo "⚠️  无法进入 backend 目录，跳过验证"; exit 0; }

if [ -f "package.json" ]; then
  bun run modules:validate
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ 模块依赖关系验证失败！提交已阻止。"
    echo "   请修复上述问题后重新提交。"
    echo "   如果你修改了模块结构，请运行: bun run modules:snapshot"
    exit 1
  fi
fi

exit 0
`;

  writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log(`✅ pre-commit 钩子已安装: ${hookPath}`);
}

/**
 * 主函数
 */
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
