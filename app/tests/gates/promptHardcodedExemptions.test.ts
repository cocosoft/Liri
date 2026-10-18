/**
 * `lint:prompt-hardcoded` 豁免清单的**新鲜度 + 完备性**守卫（2026-10-18）。
 *
 * 判据：
 * - **完备性**：`src/tools/**​/prompt.ts` 中含中文正文的文件**必须**在豁免清单里
 *   （新增第 4 个硬编码提示词 ⇒ 要么走 T2 资源链，要么显式登记豁免并写理由）；
 * - **新鲜度**：清单里每一条都必须**仍存在且仍含中文**（文件删除/改英文后即报红，
 *   防止豁免永久腐烂）；
 * - **理由非空**：空理由与「静默忽略」等价。
 */
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { HARDCODED_PROMPT_EXEMPTIONS } from '../../scripts/lib/promptHardcodedExemptions';

const APP_ROOT = join(import.meta.dir, '..', '..');
const TOOLS_ROOT = join(APP_ROOT, 'src', 'tools');
const GATE_SCRIPT = join(APP_ROOT, 'scripts', 'lint-prompt-hardcoded.ts');
const CJK = /[\u4e00-\u9fa5]/;

function findPromptModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPromptModules(full));
    else if (entry.name === 'prompt.ts') out.push(full);
  }
  return out;
}

function appRelative(full: string): string {
  return relative(APP_ROOT, full).replace(/\\/g, '/');
}

describe('lint:prompt-hardcoded 豁免清单', () => {
  it('完备性：所有含中文的 prompt.ts 都已登记豁免', () => {
    const unregistered = findPromptModules(TOOLS_ROOT)
      .filter((full) => CJK.test(readFileSync(full, 'utf-8')))
      .map(appRelative)
      .filter((rel) => !HARDCODED_PROMPT_EXEMPTIONS.has(rel));

    expect(
      unregistered,
      '含中文的 prompt.ts 必须走 T2 资源链，或在 promptHardcodedExemptions.ts 显式登记'
    ).toEqual([]);
  });

  it('新鲜度：每条豁免仍存在且仍含中文（防陈旧条目）', () => {
    const stale: string[] = [];
    for (const [rel, reason] of HARDCODED_PROMPT_EXEMPTIONS) {
      const full = join(APP_ROOT, rel);
      if (!existsSync(full)) {
        stale.push(`${rel}: 文件不存在`);
        continue;
      }
      if (!CJK.test(readFileSync(full, 'utf-8'))) {
        stale.push(`${rel}: 已无中文正文（应移除豁免）`);
      }
      if (!reason.trim()) stale.push(`${rel}: 理由为空`);
    }
    expect(stale).toEqual([]);
  });
});

describe('lint:prompt-hardcoded 阻断语义（--strict 不得被吞）', () => {
  function runGate(args: string[], root: string) {
    return spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LINT_PROMPT_HARDCODED_TOOLS_ROOT: root },
    });
  }

  it('默认只上报；--strict 阻断；--report-only 优先', () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-prompt-hardcoded-'));
    mkdirSync(join(root, 'FakeTool'), { recursive: true });
    writeFileSync(
      join(root, 'FakeTool', 'prompt.ts'),
      'export const P = "你好";\n'
    );
    try {
      // 降噪期默认：warning 只上报（exit 0）
      const soft = runGate([], root);
      expect(soft.status).toBe(0);
      expect(soft.stdout).toContain('HARDCODED_PROMPT');

      // 修复前脚本恒传 reportOnly: true ⇒ 这里会是 0（旗标被静默吞掉）
      const strict = runGate(['--strict'], root);
      expect(strict.status).toBe(1);
      expect(strict.stderr).toContain('--strict');

      // 显式 --report-only 优先于 --strict（回到只上报）
      const explicit = runGate(['--strict', '--report-only'], root);
      expect(explicit.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
