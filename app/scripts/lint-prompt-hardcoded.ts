/**
 * C-5（2026-10-18）`lint:prompt-hardcoded` —— 硬编码提示词上报（**降噪期不阻断**）。
 *
 * 范围：`src/tools/<Tool>/prompt.ts` 中仍含中文正文的提示词导出。
 * S-P4（2026-10-18）已处置 31 个零消费者 `*_TOOL_PROMPT`（删除，见台账）；
 * 现存 **3 个**有读取点的描述导出 —— 它们是 `resolveToolPrompt()` 的**内置兜底**
 * （资源缺失时必须回退源码），因此按 `.trae` 口径**登记豁免**（显式打印理由），
 * 而不是删正文或静默忽略。新增第 4 个含中文的 `prompt.ts` 仍会告警。
 *
 * **豁免清单**：`scripts/lib/promptHardcodedExemptions.ts`（与 C-2 的
 * `builtinSections.ts` 同一设计理由）；陈旧条目由
 * `tests/gates/promptHardcodedExemptions.test.ts` 报红。
 *
 * 推进（2026-10-18 **已切换阻断**）：直接运行脚本默认仍只上报（便于排查）；
 * `ci` 与 GitHub CI 通过 `package.json` 的 `lint:prompt-hardcoded` 以 `--strict` 运行
 * ⇒ warning 阻断。原计划「稳定两周后切换」由用户裁定提前执行（依据：0 issue +
 * 3 条登记豁免 + 行为级守卫三态断言）。
 *
 * 用法：`bun run scripts/lint-prompt-hardcoded.ts [--json] [--strict] [--report-only]`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { PromptIssue } from '../src/services/prompt/PromptValidator';
import {
  parseGateArgs,
  reportPromptGate,
  type PromptGateExemption,
} from './lib/promptLintReport';
import { HARDCODED_PROMPT_EXEMPTIONS } from './lib/promptHardcodedExemptions';

const SRC_ROOT = join(import.meta.dir, '..', 'src');
/** 扫描根：仅测试用于注入临时 fixture（生产恒为 `src/tools`） */
const TOOLS_ROOT =
  process.env.LINT_PROMPT_HARDCODED_TOOLS_ROOT || join(SRC_ROOT, 'tools');
const CJK = /[\u4e00-\u9fa5]/;

/** 递归找 `prompt.ts`（工具目录约定：`src/tools/<Tool>/prompt.ts`） */
function findPromptModules(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...findPromptModules(full));
    } else if (name.name === 'prompt.ts') {
      out.push(full);
    }
  }
  return out;
}

function main(): {
  issues: PromptIssue[];
  exemptions: PromptGateExemption[];
} {
  const issues: PromptIssue[] = [];
  const exemptions: PromptGateExemption[] = [];
  for (const path of findPromptModules(TOOLS_ROOT)) {
    const source = readFileSync(path, 'utf-8');
    if (!CJK.test(source)) continue;
    const entry = relative(join(import.meta.dir, '..'), path).replace(
      /\\/g,
      '/'
    );
    const reason = HARDCODED_PROMPT_EXEMPTIONS.get(entry);
    if (reason) {
      exemptions.push({ entry, reason });
      continue;
    }
    issues.push({
      code: 'HARDCODED_PROMPT',
      severity: 'warning',
      entry,
      message: '提示词正文仍硬编码在源码（应走 T2 资源链）',
    });
  }
  return { issues, exemptions };
}

const args = parseGateArgs(process.argv.slice(2));
const { issues, exemptions } = main();
// 不恒传 `reportOnly: true`（修复前如此 ⇒ `--strict` 永远被吞）：
// 默认无旗标时 warning 不阻断；`--strict` 让 warning 阻断；`--report-only` 显式只上报。
reportPromptGate('hardcoded', issues, { ...args, exemptions });
// lint:exit —— 入口脚本必须显式退出，避免依赖拉起的句柄让命令卡住
process.exit(0);
