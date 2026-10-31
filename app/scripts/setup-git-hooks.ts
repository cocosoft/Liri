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
    join(__dirname, '..', '..', '.git'), // 项目根目录
    join(__dirname, '..', '.git'), // app 目录
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
  # AR-3（2026-10-06）：**不再容忍 exit 2**。原条件（-ne 0 且 -ne 2）把
  # "检查器自身崩溃（如配置 JSON 解析失败）"当作通过 ⇒ 门禁静默降级为"只跑了一部分检查"。
  if [ $RESULT -ne 0 ]; then
    echo ""
    if [ $RESULT -eq 2 ]; then
      echo "❌ 架构合规检查器异常退出（exit 2）！提交已阻止。"
      echo "   这表示检查器自身崩溃（配置解析失败 / 路径不存在等），"
      echo "   此时结果不可信（可能只完成了一部分检查）。请先修复检查器。"
    else
      echo "❌ 架构合规检查失败！提交已阻止。"
      echo "   请修复上述违规后重新提交。"
    fi
    echo "   检查规则: .trae/rules/architecture-compliance.md"
    exit 1
  fi
fi

# ── infra 层边界契约门禁（2026-10-31）──
# R1 模块顶层 I/O / R2 审批编排不下沉 / R3 infra 动态导入上层（白名单清零）/ R4 common·utils 重复导出。
# 规范见 .trae/specs/infra-layer-boundary-contract.md §5/§8；实测约 2s。
if [ -f "app/scripts/lint-infra-boundary.ts" ]; then
  echo "  检查 infra 层边界契约（R1–R4）..."
  $RUNNER app/scripts/lint-infra-boundary.ts
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ infra 层边界契约门禁失败！提交已阻止。"
    echo "   规范: .trae/specs/infra-layer-boundary-contract.md §5"
    echo "   白名单: .trae/architecture/infra-boundary-allowlist.json"
    exit 1
  fi
fi

# ── STATUS.md 漂移门禁（2026-10-31，deepseek 建议 §3）──
# README 已不再写「多少个工具/通道/模块」，数字只在 STATUS.md 出现且由事实源现算。
# 改了事实源却忘更新 STATUS ⇒ 此处拦住（实测 <0.3s）。
if [ -f "app/scripts/gen-status.ts" ]; then
  echo "  检查 STATUS.md 与事实源是否一致..."
  $RUNNER app/scripts/gen-status.ts --check > /dev/null 2>&1
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ STATUS.md 与事实源不一致！提交已阻止。"
    echo "   修复: cd app && bun run gen:status && git add ../STATUS.md"
    exit 1
  fi
fi

# ── 支持等级台账漂移门禁（2026-10-31，deepseek 建议 §2）──
# 通道/工具的等级与「专属测试证据」由 app/docs/SUPPORT-LEVELS.md 摊开；
# 新增通道/工具或补测试后须重新生成，否则台账与事实不符（实测 <0.5s）。
if [ -f "app/scripts/gen-support-levels.ts" ]; then
  echo "  检查支持等级台账..."
  $RUNNER app/scripts/gen-support-levels.ts --check > /dev/null 2>&1
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ 支持等级台账与事实源/测试集不一致！提交已阻止。"
    echo "   修复: cd app && bun run gen:support-levels && git add docs/SUPPORT-LEVELS.md"
    exit 1
  fi
fi

# ── 修复证据登记门禁（HD-INFRA-1c / Q-H6：前置，消除"推送后才发现"的滞后）──
# 轻量但完整：JSON 可解析（含未转义 ASCII 引号的精确定位）+ 证据路径与状态自洽。
# 规范见 .trae/rules/coding-standards.md §CS08。
if [ -f "scripts/lint-fix-evidence.ts" ]; then
  echo "  检查修复证据登记（JSON 可解析 + 未转义 ASCII 引号）..."
  $RUNNER scripts/lint-fix-evidence.ts
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ 修复证据登记门禁失败！提交已阻止。"
    echo "   规则: .trae/rules/coding-standards.md §CS08"
    exit 1
  fi
fi

# ── GitHub Actions YAML 可解析门禁（2026-10-24）──
# 实证：步骤名写成 name: Package build (tsc: barrel ...) 时，未加引号的冒号+空格
# 会被 YAML 当成映射 ⇒ GitHub 判定整个 workflow 无效（表现为一条 0 job、
# 名字是文件路径的失败记录）。本地 typecheck / eslint / lint 都不解析 workflow
# ⇒ 只能靠这一条前置拦住。
if [ -f "app/scripts/lint-workflows.ts" ]; then
  echo "  检查 GitHub Actions YAML（可解析 + 结构完整）..."
  $RUNNER app/scripts/lint-workflows.ts
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    echo ""
    echo "❌ GitHub Actions YAML 门禁失败！提交已阻止。"
    echo "   常见原因：未加引号的 name: xxx (a: b) —— 把整行加引号即可。"
    exit 1
  fi
fi

# ── 进入 app 目录验证 ──
# 记录「本次已暂存的文件」：ESLint --fix 会在**暂存之后**就地改文件，若不重新暂存，
# 提交里仍是未修复内容 ⇒ 本地绿、CI 的 lint 红（2026-10-23 本仓实证 3 次：22/22/8 个文件）。
STAGED_BEFORE_FIX=$(git diff --cached --name-only --diff-filter=ACMR)

cd "$PROJECT_DIR/app" || exit 0

# ── 棘轮门禁（2026-10-26 前置）──
# 只放**快**的（实测：state-ratchet 0.9s / fn-size 0.1s / consts 1.3s / unref 0.8s）；
# lint:complexity 约 42s，留在 CI。动机：2026-10-26 曾出现「本地 tsc/eslint/arch 全绿、
# CI 的 lint:state-ratchet 红」——新增文件写了状态词汇裸字面量。
for GATE in lint:state-ratchet lint:fn-size lint:consts lint:unref; do
  echo "  棘轮门禁: $GATE ..."
  if ! bun run "$GATE" > /dev/null 2>&1; then
    echo ""
    echo "❌ 棘轮门禁失败：$GATE（提交已阻止）"
    echo "   明细: cd app && bun run $GATE"
    bun run "$GATE" || true
    exit 1
  fi
done

# ── 生成物 / 边界 / 体量门禁（2026-10-31 前置；实测合计 <10s）──
# 动机（台账 2026-10-31 全量门禁审计）：7 项 CI 红里有 4 项（startup-graph / kernel K08 /
# architecture-boundaries W4 / params 资源）都是「pre-commit 不跑 ⇒ 提交后才发现」。
# 四项均 <3s，前移后可在提交时拦住；lint:complexity（≈42s）仍留 CI。
for GATE in lint:startup-graph lint:kernel lint:architecture-boundaries params:check; do
  echo "  生成物门禁: $GATE ..."
  if ! bun run "$GATE" > /dev/null 2>&1; then
    echo ""
    echo "❌ 生成物门禁失败：$GATE（提交已阻止）"
    echo "   明细: cd app && bun run $GATE"
    bun run "$GATE" || true
    exit 1
  fi
done

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
if [ -n "$STAGED_BEFORE_FIX" ]; then
  echo "  重新暂存 ESLint --fix 的修复结果..."
  cd "$PROJECT_DIR" || exit 0
  printf '%s\n' "$STAGED_BEFORE_FIX" | while IFS= read -r f; do
    [ -f "$f" ] && git add -- "$f"
  done
  cd "$PROJECT_DIR/app" || exit 0
fi

if grep -q '"modules:validate"' package.json 2>/dev/null; then
  echo "  验证模块依赖..."
  bun run modules:validate 2>/dev/null || echo "  ⚠️ 模块验证有警告"
fi

echo "✅ 提交前检查通过"
exit 0
`;

  writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log(`✅ pre-commit 钩子已安装: ${hookPath}`);
  console.log(
    '   提交前自动运行: 架构合规检查 + infra 层边界契约 + STATUS.md / 支持等级台账漂移 + 修复证据登记 + GitHub Actions YAML + 棘轮门禁(state/fn-size/consts/unref) + 生成物门禁(startup-graph/kernel/architecture-boundaries/tool-params) + 类型检查 + ESLint + 模块验证'
  );
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

// 显式退出（台账 N-16 / N-49 约定）：入口脚本必须主动结束进程——
// 一旦将来经依赖引入长驻句柄（定时器 / DB / OAuth 等），逻辑跑完后进程不会自行退出，
// 表现为"命令卡住不返回"。错误分支的 `process.exit(1)` 不受影响（它会先终止进程）。
process.exit(0);
