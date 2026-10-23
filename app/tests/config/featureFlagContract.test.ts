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
  resetBuildVariantFlags,
  setBuildVariantFlags,
  type FeatureFlag,
} from '../../src/core/featureFlags.js';
// P3（2026-10-23）：构建变体层改为**宿主注入**；生成物落在 `bootstrap/`（内核不再持有）
import { BUILD_VARIANT_FLAGS } from '../../src/bootstrap/generatedVariantFlags.js';
import { AppError } from '../../src/core/errors.js';

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

describe('W3 可复现性裁定（演进方案 §3 · 2026-10-21 用户「开启严格重放」）', () => {
  it('PREPARED_SNAPSHOT_REPLAY 默认开启，且无环境覆盖时读值同为 true', () => {
    // 裁定口径：开 ⇒ 续跑「重发一轮」分支强制套用落盘快照的 visibleTools（可复现性硬约束）；
    // 无快照回落当前计算、不硬失败。若改回默认关，本用例立即变红，强制同步文档。
    expect(FEATURE_FLAGS.PREPARED_SNAPSHOT_REPLAY).toBe(true);
    delete process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'];
    expect(feature('PREPARED_SNAPSHOT_REPLAY')).toBe(true);
  });

  it('显式 FEATURE_PREPARED_SNAPSHOT_REPLAY=false 可关闭（逃生开关）', () => {
    touched.push('PREPARED_SNAPSHOT_REPLAY');
    process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'] = 'false';
    expect(feature('PREPARED_SNAPSHOT_REPLAY')).toBe(false);
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

/**
 * D1（2026-10-11 用户裁定「接线」）：`feature()` 的**中间层** —— 构建变体
 * `BUILD_VARIANT_FLAGS`（由 `scripts/build-variant.ts` 构建期生成）。
 *
 * 三层优先（高 → 低）：`FEATURE_*` env → `BUILD_VARIANT_FLAGS` → `FEATURE_FLAGS`。
 */
describe('D1 构建变体层：feature() 三层优先', () => {
  // P3：与生产入口一致 —— 先注入变体层，再断言三层优先
  setBuildVariantFlags(BUILD_VARIANT_FLAGS);

  /** 纯判据（抽函数以便负向夹具自证）：变体键必须是合法 FeatureFlag */
  function findUnknownVariantFlags(
    flags: Readonly<Record<string, unknown>>,
    known: Readonly<Record<string, unknown>>
  ): string[] {
    return Object.keys(flags)
      .filter((k) => !(k in known))
      .sort();
  }

  it('门禁：BUILD_VARIANT_FLAGS 的每个键都必须是合法 FeatureFlag（防拼错/死键）', () => {
    expect(findUnknownVariantFlags(BUILD_VARIANT_FLAGS, FEATURE_FLAGS)).toEqual(
      []
    );
  });

  it('门禁自证（负向夹具）：虚构键会被判违规 ⇒ 门禁非恒真', () => {
    const fixture = { LSP: true, BILLING_TIER: true }; // BILLING_TIER 不存在
    expect(findUnknownVariantFlags(fixture, FEATURE_FLAGS)).toEqual([
      'BILLING_TIER',
    ]);
  });

  it('变体层优先于静态默认：无 env 时 feature(k) == BUILD_VARIANT_FLAGS[k]', () => {
    const keys = Object.keys(BUILD_VARIANT_FLAGS) as FeatureFlag[];
    expect(keys.length).toBeGreaterThan(0); // 防空表恒真
    for (const k of keys) {
      delete process.env[`FEATURE_${k}`];
      expect(feature(k)).toBe(
        (BUILD_VARIANT_FLAGS as Readonly<Record<string, boolean>>)[k]
      );
    }
  });

  it('env 覆盖变体层：写入反向值时 env 胜出', () => {
    for (const [k, v] of Object.entries(BUILD_VARIANT_FLAGS)) {
      touched.push(k);
      process.env[`FEATURE_${k}`] = v ? 'false' : 'true';
      expect(feature(k as FeatureFlag)).toBe(!v);
      delete process.env[`FEATURE_${k}`];
    }
  });

  it('变体未声明的键回落静态默认（样例：SANDBOX 不在变体表内）', () => {
    expect(
      Object.prototype.hasOwnProperty.call(BUILD_VARIANT_FLAGS, 'SANDBOX')
    ).toBe(false);
    delete process.env['FEATURE_SANDBOX'];
    expect(feature('SANDBOX')).toBe(FEATURE_FLAGS.SANDBOX);
  });
});

/**
 * P3（2026-10-23，Google 复审 G4）：**注入时序守卫**。
 *
 * 未注入变体层就求值 ⇒ 静默回落到静态默认会让「变体裁剪」无声失真。
 * 非测试环境必须硬失败；测试环境豁免（单测不应被迫装配变体层）。
 */
describe('P3 变体层时序守卫', () => {
  const ORIGINAL_ENV = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = ORIGINAL_ENV;
    setBuildVariantFlags(BUILD_VARIANT_FLAGS); // 复原，避免污染后续用例
  });

  it('未注入 + 非测试环境 ⇒ 抛 CORE_VARIANT_FLAGS_NOT_INITIALIZED', () => {
    resetBuildVariantFlags();
    process.env['NODE_ENV'] = 'production';
    delete process.env['FEATURE_LSP'];

    expect(() => feature('LSP')).toThrow(AppError);
    try {
      feature('LSP');
    } catch (err) {
      expect((err as AppError).code).toBe('CORE_VARIANT_FLAGS_NOT_INITIALIZED');
      expect((err as AppError).context).toEqual({ name: 'LSP' });
    }
  });

  it('未注入 + 测试环境 ⇒ 豁免（回落静态默认，不抛错）', () => {
    resetBuildVariantFlags();
    process.env['NODE_ENV'] = 'test';
    delete process.env['FEATURE_SANDBOX'];

    expect(() => feature('SANDBOX')).not.toThrow();
    expect(feature('SANDBOX')).toBe(FEATURE_FLAGS.SANDBOX);
  });

  it('注入后同环境求值 ⇒ 走变体层（守卫不误伤）', () => {
    resetBuildVariantFlags();
    process.env['NODE_ENV'] = 'production';
    setBuildVariantFlags(BUILD_VARIANT_FLAGS);
    delete process.env['FEATURE_LSP'];

    expect(feature('LSP')).toBe(BUILD_VARIANT_FLAGS.LSP);
  });
});
