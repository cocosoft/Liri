/**
 * P1-8 —— **配置契约测试**：灰度/安全开关的三段一致性
 * （`.trae/specs` 之外的行为契约；来源 `dev_docs/20261010/升级优化方案-20261010.md` §3）
 *
 * 三段（缺一漏一即"配置漂移"）：
 *  ① **代码声明默认值 ⇔ 文档登记值**（`project_rules.md §1.4`）—— 与 `lint:doc-code` **同源互证**；
 *  ② **无环境变量时** 运行时读值 == 声明默认值；
 *  ③ **`FEATURE_<NAME>` 环境覆盖** ⇒ 运行时读值随之变化（且**仅 `'true'` 视为开**）。
 *
 * 这样"改默认值却不更新文档"或"环境覆盖失效"都会**立即变红**（对应验收：每开关一条契约用例）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FEATURE_FLAGS,
  feature,
  type FeatureFlag,
} from '../../src/core/featureFlags.js';

/** 与 `scripts/check-doc-code-consistency.js` 的 `SAFETY_SWITCHES` 同集的 **17 项**安全/灰度开关 */
const SAFETY_SWITCHES: readonly FeatureFlag[] = [
  'VERIFIER_FAIL_CLOSED',
  'PERMISSION_CHECKS',
  'SECURITY_SCAN',
  'SECURITY_AUDIT',
  'SANDBOX',
  'UNATTENDED_MODE',
  'OUTPUT_GUARD',
  'OUTPUT_GUARD_BLOCK',
  'OUTPUT_GUARD_KEEP_ORIGINAL',
  'RESOURCE_GOVERNOR',
  'PRO_SECURITY_SUITE',
  'BASH_APPROVED_REVALIDATE',
  'BASH_INTERPRETER_GUARD',
  'BASH_APPROVAL_STRICT',
  'EXECUTION_TWO_PHASE_CANCEL',
  'CODE_RUN_DEEP_SCAN_STRICT',
  'CLIENT_STREAM_EXECUTION',
];

// 以**本文件位置**解析（不依赖 cwd，避免从仓库根/其它目录运行 bun test 时取错路径）
const RULES_PATH = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '.trae/rules/project_rules.md'
);
const rulesText = readFileSync(RULES_PATH, 'utf8');

/** 从 `project_rules.md §1.4` 表取登记默认值（`| \`NAME\` | \`true|false\` |`） */
function documentedDefault(name: string): boolean | null {
  const re = new RegExp(`\\|\\s*\`${name}\`\\s*\\|\\s*\`(true|false)\``);
  const m = rulesText.match(re);
  return m ? m[1] === 'true' : null;
}

const touched: string[] = [];
afterEach(() => {
  for (const name of touched.splice(0)) delete process.env[`FEATURE_${name}`];
});

describe('P1-8 配置契约 · ① 代码默认值 ⇔ 文档登记值', () => {
  it(`17 项安全开关的默认值均与 project_rules.md §1.4 一致`, () => {
    const mismatches: string[] = [];
    for (const name of SAFETY_SWITCHES) {
      const doc = documentedDefault(name);
      if (doc === null) {
        mismatches.push(`${name}: 文档未登记`);
        continue;
      }
      if (FEATURE_FLAGS[name] !== doc) {
        mismatches.push(
          `${name}: 代码=${FEATURE_FLAGS[name]} 文档=${doc}（改默认值须同批更新文档与断言表）`
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('开关清单覆盖 17 项且无重复（防漏登记）', () => {
    expect(new Set(SAFETY_SWITCHES).size).toBe(SAFETY_SWITCHES.length);
    expect(SAFETY_SWITCHES.length).toBe(17);
  });
});

describe('P1-8 配置契约 · ② 无覆盖时读值 == 声明默认值', () => {
  it('每项在无 `FEATURE_*` 环境变量时，`feature()` == `FEATURE_FLAGS[]`', () => {
    for (const name of SAFETY_SWITCHES) {
      delete process.env[`FEATURE_${name}`];
      expect(feature(name)).toBe(FEATURE_FLAGS[name]);
    }
  });
});

describe('P1-8 配置契约 · ③ `FEATURE_*` 环境覆盖生效且语义一致', () => {
  it('`=true` ⇒ 读真；`=false` ⇒ 读假（覆盖默认）', () => {
    for (const name of SAFETY_SWITCHES) {
      const def = FEATURE_FLAGS[name];
      touched.push(name);
      process.env[`FEATURE_${name}`] = 'true';
      expect(feature(name)).toBe(true);
      process.env[`FEATURE_${name}`] = 'false';
      expect(feature(name)).toBe(false);
      // 复原默认（防串扰）
      delete process.env[`FEATURE_${name}`];
      expect(feature(name)).toBe(def);
    }
  });

  it('语义红线：**仅字符串 `true` 视为开** —— `1`/`yes`/空串一律为关', () => {
    const name = SAFETY_SWITCHES[0];
    touched.push(name);
    for (const v of ['1', 'yes', 'TRUE', '', 'on']) {
      process.env[`FEATURE_${name}`] = v;
      expect(feature(name)).toBe(false);
    }
    delete process.env[`FEATURE_${name}`];
  });
});
