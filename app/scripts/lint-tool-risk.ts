/**
 * lint-tool-risk.ts — 工具**风险声明**门禁（PR-0，2026-10-23）
 *
 * 两道检查（都基于**真实实例化**，与 `gen-tool-names` 同口径）：
 * 1. **一致性**（ERROR）：声明为只读（`riskClass === 'read'` 或 `riskClassFor({})==='read'`）
 *    但 `isReadOnly({}) === false` ⇒ 视为"声明与实际相反"，直接失败；
 * 2. **未声明棘轮**（WARN + 新条目 ERROR）：派生结果为 `undeclared` 的工具必须登记在
 *    基线 `.trae/architecture/tool-risk-baseline.json`；**新增**未声明工具 ⇒ ERROR。
 *
 * 用法：
 *   bun run lint:tool-risk                   # 校验
 *   bun run lint:tool-risk --update-baseline # 用当前状态刷新基线（仅在有意识接受时）
 *
 * 边界：本脚本**只读**（不注册工具、不改运行时）；实例化失败的工具跳过并告警（不误杀）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';
import { deriveToolRiskClass } from '../src/tools/toolRiskClass';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(
  HERE,
  '..',
  '..',
  '.trae',
  'architecture',
  'tool-risk-baseline.json'
);

interface Baseline {
  note?: string;
  undeclared: string[];
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return { undeclared: [] };
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    return { undeclared: Array.isArray(raw.undeclared) ? raw.undeclared : [] };
  } catch {
    return { undeclared: [] };
  }
}

function writeBaseline(undeclared: string[]): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  const payload: Baseline = {
    note: 'PR-0 工具风险声明棘轮基线（派生为 undeclared 的工具）。新工具缺风险声明 ⇒ lint:tool-risk ERROR；随声明/下线逐项收敛。由 --update-baseline 生成，勿手改。',
    undeclared: [...undeclared].sort(),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main(): number {
  const update = process.argv.includes('--update-baseline');
  const factory = new ToolFactory();
  const tools = loadTools(factory, getAllBuiltinToolLoaders());

  const undeclared: string[] = [];
  const inconsistencies: string[] = [];
  const skipped: string[] = [];

  for (const tool of tools) {
    try {
      const risk = deriveToolRiskClass(tool, {});
      if (risk === 'undeclared') undeclared.push(tool.name);

      const declared = (() => {
        if (tool.riskClass) return tool.riskClass;
        try {
          return tool.riskClassFor?.({});
        } catch {
          return undefined;
        }
      })();
      const declaredRead = declared === 'read';
      const readOnly = (() => {
        try {
          return tool.isReadOnly({});
        } catch {
          return undefined;
        }
      })();
      if (declaredRead && readOnly === false) {
        inconsistencies.push(
          `${tool.name}: 声明 read 但 isReadOnly()===false（声明与实际相反）`
        );
      }
    } catch (e) {
      skipped.push(`${tool.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (update) {
    writeBaseline(undeclared);
    console.log(
      `[lint-tool-risk] 基线已更新：undeclared=${undeclared.length} → ${BASELINE_PATH}`
    );
    return 0;
  }

  const baseline = new Set(readBaseline().undeclared);
  const newUndeclared = undeclared.filter((n) => !baseline.has(n));
  const fixed = [...baseline].filter((n) => !undeclared.includes(n));

  console.log('=== 工具风险声明门禁（PR-0） ===');
  console.log(
    `实测工具 ${tools.length} 个 · undeclared ${undeclared.length} · 基线 ${baseline.size} · 一致性违规 ${inconsistencies.length}`
  );
  if (skipped.length > 0) {
    console.warn(`[WARN] 实例化失败已跳过 ${skipped.length} 个：\n  ${skipped.join('\n  ')}`);
  }
  if (undeclared.length > 0) {
    console.log(`undeclared: ${undeclared.sort().join(', ')}`);
  }
  if (fixed.length > 0) {
    console.log(
      `ℹ️ 已收敛（可从基线移除）：${fixed.join(', ')} —— 建议 --update-baseline`
    );
  }
  for (const item of inconsistencies) {
    console.error(`[ERROR] ${item}`);
  }
  for (const name of newUndeclared) {
    console.error(
      `[ERROR] 新增未声明风险的工具：${name}（请声明 riskClass / riskClassFor，或加入基线并说明理由）`
    );
  }

  if (inconsistencies.length > 0 || newUndeclared.length > 0) {
    console.error('存在 ERROR 级别违规，请修复后重新提交。');
    return 1;
  }
  console.log('✅ 通过（无新增未声明、无声明/实际相反）');
  return 0;
}

process.exit(main());
