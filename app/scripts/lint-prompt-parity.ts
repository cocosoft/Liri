/**
 * C-5（2026-10-18）`lint:prompt-parity` —— manifest ↔ 目录一致性。
 *
 * 范围：`MANIFEST_MISSING` / `FILE_MISSING` / `FILE_EMPTY`（error）
 *      + `FILE_ORPHAN`（warning：目录有 manifest 未登记的文件）。
 * 单一实现见 `src/services/prompt/PromptValidator.ts`。
 *
 * 用法：`bun run scripts/lint-prompt-parity.ts [--strict] [--json]`
 */
import {
  validatePromptResources,
  type PromptIssue,
} from '../src/services/prompt/PromptValidator';
import {
  parseGateArgs,
  reportPromptGate,
} from './lib/promptLintReport';

const CODES = new Set<PromptIssue['code']>([
  'MANIFEST_MISSING',
  'FILE_MISSING',
  'FILE_EMPTY',
  'FILE_ORPHAN',
]);

const { issues } = validatePromptResources();
reportPromptGate(
  'parity',
  issues.filter((i) => CODES.has(i.code)),
  parseGateArgs(process.argv.slice(2))
);
// lint:exit —— 入口脚本必须显式退出，避免依赖拉起的句柄让命令卡住
process.exit(0);
