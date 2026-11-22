/**
 * lint-tool-interception-reasons.ts — 工具拦截 reason 码**双向对账**（P2-2 / G7，2026-11-22）
 *
 * 判据（fail-closed）：
 * 1. 扫描面（由 `INTERCEPTION_REASON_SOURCES` 派生）里出现的 `reason: '<code>'` 必须已登记；
 * 2. 登记表里的每个码必须在扫描面真实存在（防僵尸登记）；
 * 3. 登记来源文件未纳入扫描 ⇒ 失败（防止"登记了但没人扫"）。
 *
 * 边界：bash 域由 `tools/bash/commandGateRegistry.ts` 单独对账，本脚本不重复。
 *
 * 用法：`bun run lint:tool-interception-reasons`（CI 静态检查 job 与 `bun run ci`）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INTERCEPTION_REASON_SOURCES,
  validateInterceptionReasons,
} from '../src/tools/governance/interceptionReasons';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');

function main(): number {
  const sources: Array<{ file: string; text: string }> = [];
  for (const { file } of INTERCEPTION_REASON_SOURCES) {
    try {
      sources.push({
        file,
        text: readFileSync(resolve(REPO_ROOT, file), 'utf8'),
      });
    } catch (error) {
      console.error(
        `❌ [tool-interception-reasons] 读取扫描面失败：${file}（${error instanceof Error ? error.message : String(error)}）`
      );
      return 1;
    }
  }

  const errors = validateInterceptionReasons(sources);
  console.log('=== 工具拦截 reason 码登记（G7） ===');
  console.log(
    `扫描 ${sources.length} 个源文件 · 登记 ${INTERCEPTION_REASON_SOURCES.length} 个来源`
  );
  if (errors.length > 0) {
    console.error(`❌ [tool-interception-reasons] ${errors.length} 项失败：`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(
    '✅ 拦截 reason 码双向对账通过（shell 域见 commandGateRegistry）'
  );
  return 0;
}

process.exit(main());
