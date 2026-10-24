/**
 * `@openliri/kernel` 桶契约冒烟。
 *
 * **为什么存在**：包内唯一的历史测试（`memory-host-sdk.test.ts`）随该模块一并删除后，
 * `packages/kernel` 会变成"零测试文件"——`bun test` 对零测试是 **exit 1**，
 * Kernel CI 的 Package tests 会因此假红（2026-10-24 实测）。
 * 本文件不测业务，只钉住**包本身就是可用内核**这条对外承诺：
 * 标识/版本常量存在，且桶确实导出了宿主开工所需的那几个符号。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  KERNEL_PACKAGE_NAME,
  KERNEL_PACKAGE_VERSION,
  configureProductIdentity,
  feature,
  getProductIdentity,
  globalEventBus,
  resetProductIdentity,
  resolveDbPath,
} from './index.js';

describe('@openliri/kernel 桶契约（冒烟）', () => {
  it('包标识与版本常量存在且形如 semver', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('桶导出宿主开工所需的关键符号', () => {
    // 变体开关（宿主注入）、路径解析、错误基类、事件总线 —— 缺任一项内核即不可用
    expect(typeof feature).toBe('function');
    expect(typeof resolveDbPath).toBe('function');
    expect(typeof AppError).toBe('function');
    expect(globalEventBus).toBeDefined();
  });
});

/**
 * 产品身份注入（去产品化 Q3，见 `dev_docs/20261024/基础设施专项-现状与规划.md` §4.2）。
 *
 * 两件事必须同时成立，否则"去产品化"就是空话：
 *   ① 未注入时 = 现有产品身份（本仓零行为变更）；
 *   ② 注入后，前缀与目录名**真的**跟着变（不是只改了个常量）。
 */
describe('产品身份注入（Q3 去产品化）', () => {
  it('默认身份 = 现有产品（appName=pyapp / envPrefix=LIRI_）', () => {
    resetProductIdentity();
    expect(getProductIdentity()).toEqual({
      appName: 'pyapp',
      envPrefix: 'LIRI_',
    });
  });

  it('注入 envPrefix 后，路径解析改用新前缀；reset 后恢复', () => {
    const fakeHome = join(process.cwd(), 'kernel-test-home');
    const env = (key: string): NodeJS.ProcessEnv => ({ [key]: fakeHome });

    // 默认身份：读 LIRI_DATA_DIR
    expect(resolveDbPath(env('LIRI_DATA_DIR'))).toContain('kernel-test-home');

    configureProductIdentity({ envPrefix: 'ACME' });
    try {
      // 旧前缀不再生效；新前缀生效（`ACME` 自动补成 `ACME_`）
      expect(resolveDbPath(env('LIRI_DATA_DIR'))).not.toContain(
        'kernel-test-home'
      );
      expect(resolveDbPath(env('ACME_DATA_DIR'))).toContain(
        'kernel-test-home'
      );
    } finally {
      resetProductIdentity();
    }

    expect(resolveDbPath(env('LIRI_DATA_DIR'))).toContain('kernel-test-home');
  });

  it('空白 appName / envPrefix ⇒ 抛 CORE_PRODUCT_IDENTITY_INVALID', () => {
    try {
      expect(() => configureProductIdentity({ appName: '  ' })).toThrow(
        'CORE_PRODUCT_IDENTITY_INVALID'
      );
      expect(() => configureProductIdentity({ envPrefix: '' })).toThrow(
        'CORE_PRODUCT_IDENTITY_INVALID'
      );
    } finally {
      resetProductIdentity();
    }
  });
});

/**
 * 产品化字面量守卫（`基础设施专项` §4.2 的验收口径）。
 *
 * 允许出现的地方**只有一处**：`core/paths.ts` 的 `DEFAULT_PRODUCT_IDENTITY`。
 * 其余任何 `'pyapp'` 字符串都说明"又写死了一次产品名" ⇒ 红。
 * 注释不算（剥离后再判）；诊断文案里提到函数名（`resolvePyappHome()`）也不算 ——
 * 判据是**引号内的取值本身**是产品名/产品目录，而不是任意含该词的句子。
 */
describe('内核源码不含产品化字面量', () => {
  const stripComments = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  /** 引号内的取值是否"就是产品名/产品目录" */
  const isProductLiteral = (value: string): boolean =>
    /^\.?pyapp$/i.test(value) || /(^|[\\/])\.?pyapp([\\/]|$)/i.test(value);

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
    }
    return out;
  };

  it("`'pyapp'` 只出现在默认身份定义处", () => {
    const coreDir = join(import.meta.dir, 'core');
    const hits: Array<{ file: string; line: number; text: string }> = [];

    for (const file of walk(coreDir)) {
      const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, index) => {
        const quoted = [...line.matchAll(/['"`]([^'"`\n]*)['"`]/g)];
        if (quoted.some((m) => isProductLiteral(m[1] ?? ''))) {
          hits.push({ file, line: index + 1, text: line.trim() });
        }
      });
    }

    expect(hits.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([
      expect.stringContaining("appName: 'pyapp'"),
    ]);
    expect(hits[0]?.file.endsWith(join('core', 'paths.ts'))).toBe(true);
  });
});
