/**
 * C-5（2026-10-18）`lint:prompt-budget` —— 译文 token 预算。
 *
 * 范围：`LENGTH_RATIO`（> 1.5× 源 ⇒ warning；> 2× ⇒ error）。
 * 口径为 **token 估算**而非字符数（中英字符密度差异，见 C-4 量化记录）。
 *
 * 用法：`bun run scripts/lint-prompt-budget.ts [--strict] [--json]`
 */
import { validatePromptResources } from '../src/services/prompt/PromptValidator';
import {
  parseGateArgs,
  reportPromptGate,
} from './lib/promptLintReport';

const { issues } = validatePromptResources();
reportPromptGate(
  'budget',
  issues.filter((i) => i.code === 'LENGTH_RATIO'),
  parseGateArgs(process.argv.slice(2))
);
// lint:exit —— 入口脚本必须显式退出，避免依赖拉起的句柄让命令卡住
process.exit(0);
