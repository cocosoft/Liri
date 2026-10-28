/**
 * `@openliri/kernel` 桶契约冒烟。
 *
 * **为什么存在**：包内唯一的历史测试（`memory-host-sdk.test.ts`）随该模块一并删除后，
 * `packages/kernel` 会变成"零测试文件"——`bun test` 对零测试是 **exit 1**，
 * Kernel CI 的 Package tests 会因此假红（2026-10-24 实测）。
 * 本文件不测业务，只钉住**包本身就是可用内核**这条对外承诺：
 * 标识/版本常量存在，且桶确实导出了宿主开工所需的那几个符号。
 */

import { describe, expect, it, afterEach, beforeEach } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  KERNEL_PACKAGE_NAME,
  KERNEL_PACKAGE_VERSION,
  configureProductIdentity,
  feature,
  getBuildVariant,
  getBuildVariantFlags,
  getProductIdentity,
  globalEventBus,
  httpPortEnvKey,
  isBuildVariantFlagsInitialized,
  resetBuildVariantFlags,
  resetProductIdentity,
  resolveExplicitHttpPort,
  setBuildVariantFlags,
} from './index.js';
// 桶面未转出、但包内需要覆盖的符号：按**公开子路径**同形的方式从源文件导入
// （`src/*` 内部相对导入在包内与桶指向同一份文件，不产生第二实例）。
import { BUILD_VARIANTS } from './core/featureFlags.js';
import { lazySingleton } from './core/lazySingleton.js';
// P1（2026-10-28）：`paths` 已整体迁 `@modules/environment`（含 resolveDataDir /
// resolveCacheDir / resolveProjectRoot），其环境变量派生用例随实现迁至
// `app/tests/environment/pathsResolvers.test.ts`；内核不再保有目录解析。

describe('@openliri/kernel 桶契约（冒烟）', () => {
  it('包标识与版本常量存在且形如 semver', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('版本常量与 package.json 单源一致（2026-10-24 评审 #6）', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')
    ) as { version: string };
    // 常量是手抄的：发版只改 package.json 时必须同步，否则这里红
    expect(KERNEL_PACKAGE_VERSION).toBe(pkg.version);
  });

  it('桶导出宿主开工所需的关键符号', () => {
    // 变体开关（宿主注入）、产品身份、错误基类、事件总线 —— 缺任一项内核即不可用。
    // P1：目录解析（resolveDbPath 等）已随 paths 迁 `@modules/environment`，不再由桶转出。
    expect(typeof feature).toBe('function');
    expect(typeof getProductIdentity).toBe('function');
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

  it('注入 envPrefix 后身份前缀生效（路径联动用例已随 paths 迁出）', () => {
    // P1（2026-10-28）：`resolveDbPath` 随 paths 迁 `@modules/environment`，
    // 「前缀真的影响路径」的联动断言见 `app/tests/environment/productIdentityPrefix.test.ts`。
    configureProductIdentity({ envPrefix: 'ACME' });
    try {
      // `ACME` 自动补成 `ACME_`
      expect(getProductIdentity().envPrefix).toBe('ACME_');
    } finally {
      resetProductIdentity();
    }
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

  /**
   * 契约键（读/写两端必须同键）：`<prefix>HTTP_PORT` 由内核读、由
   * `app/src/entrypoints/http-server.ts` 写回，并被 client / docker / `.env.example` 引用。
   * 默认前缀下必须**逐字**是 `LIRI_HTTP_PORT` —— 这是"零行为变更"的硬证据。
   */
  it('`httpPortEnvKey()` 默认 LIRI_HTTP_PORT；注入后跟随前缀', () => {
    resetProductIdentity();
    expect(httpPortEnvKey()).toBe('LIRI_HTTP_PORT');
    expect(resolveExplicitHttpPort({ LIRI_HTTP_PORT: '3000' })).toBe(3000);

    configureProductIdentity({ envPrefix: 'ACME' });
    try {
      expect(httpPortEnvKey()).toBe('ACME_HTTP_PORT');
      expect(resolveExplicitHttpPort({ ACME_HTTP_PORT: '3001' })).toBe(3001);
      // 旧键不再被读
      expect(resolveExplicitHttpPort({ LIRI_HTTP_PORT: '3000' })).toBeUndefined();
    } finally {
      resetProductIdentity();
    }
  });
});

/**
 * 产品化字面量守卫（`基础设施专项` §4.2 的验收口径）。
 *
 * 允许出现的地方**只有一处**：`core/productIdentity.ts` 的 `DEFAULT_PRODUCT_IDENTITY`。
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
    expect(hits[0]?.file.endsWith(join('core', 'productIdentity.ts'))).toBe(
      true
    );
  });

  /**
   * `LIRI_` 前缀同理（评审 B5 的第二半）：它是 `envPrefix` 的默认值，
   * 只允许出现在默认身份定义处。**判据是引号内的取值**，因此
   * `export const LIRI_HOME` 这类**标识符**不算（它是对外导出名，改名属破坏性变更）。
   */
  it("`'LIRI_'` 前缀字面量只出现在默认身份定义处", () => {
    const coreDir = join(import.meta.dir, 'core');
    const hits: string[] = [];
    for (const file of walk(coreDir)) {
      const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, index) => {
        for (const m of line.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
          if ((m[1] ?? '').startsWith('LIRI_')) {
            hits.push(`${file}:${index + 1} ${line.trim()}`);
          }
        }
      });
    }
    expect(hits).toEqual([expect.stringContaining("envPrefix: 'LIRI_'")]);
    expect(hits[0]).toContain(join('core', 'productIdentity.ts'));
  });
});

/**
 * 内核行为的**包内**覆盖（2026-10-24 评审 B4）。
 *
 * 原状：包内只有桶契约 + 产品身份，共 7 例；阶段二抽仓后 app 侧 400+ 例留在原地，
 * 内核仓将只剩这点覆盖 ⇒ 这是比 OTel 归属更硬的准入缺口。
 * 本组按评审要求补四条主干：`featureFlags` 三级解析与时序、`paths` 环境变量派生、
 * `errors` 字段契约、`lazySingleton` 单次实例化。全部**不依赖 app 侧装配**。
 */
describe('featureFlags：三级解析与注入时序', () => {
  /** 测试环境豁免时序守卫（见 feature() 的 G4 注释），这里显式钉住，避免受执行环境影响 */
  const asTestEnv = <T>(fn: () => T): T => {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'test';
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  };

  beforeEach(() => {
    resetBuildVariantFlags();
    delete process.env['FEATURE_UNATTENDED_MODE'];
  });
  afterEach(() => {
    resetBuildVariantFlags();
    delete process.env['FEATURE_UNATTENDED_MODE'];
  });

  it('变体层声明优先于静态默认', () => {
    asTestEnv(() => {
      expect(feature('UNATTENDED_MODE')).toBe(false); // 静态默认 false
      setBuildVariantFlags({ UNATTENDED_MODE: true });
      expect(feature('UNATTENDED_MODE')).toBe(true);
    });
  });

  it('环境变量优先级最高（可覆盖变体层）', () => {
    setBuildVariantFlags({ UNATTENDED_MODE: true });
    process.env['FEATURE_UNATTENDED_MODE'] = 'false';
    expect(feature('UNATTENDED_MODE')).toBe(false);
  });

  it('未注入 + 非测试环境 ⇒ 抛 CORE_VARIANT_FLAGS_NOT_INITIALIZED', () => {
    process.env['NODE_ENV'] = 'production';
    try {
      // `code` 在 AppError 的第 4 个参数上，**不在 message 里** ⇒ 断言错误码字段，
      // 而不是 message 子串（否则测试在正确实现上也会红，2026-10-24 实测）。
      const err = (() => {
        try {
          feature('UNATTENDED_MODE');
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('CORE_VARIANT_FLAGS_NOT_INITIALIZED');
    } finally {
      process.env['NODE_ENV'] = 'test';
    }
  });

  it('注入可重复覆盖；reset 后回到「未注入」', () => {
    setBuildVariantFlags({ SANDBOX: false });
    expect(getBuildVariantFlags()).toEqual({ SANDBOX: false });
    setBuildVariantFlags({ SANDBOX: true });
    expect(getBuildVariantFlags()).toEqual({ SANDBOX: true });
    resetBuildVariantFlags();
    expect(isBuildVariantFlagsInitialized()).toBe(false);
    expect(getBuildVariantFlags()).toBeNull();
  });

  it('`getBuildVariant()` 必是已知变体之一', () => {
    expect(BUILD_VARIANTS as readonly string[]).toContain(getBuildVariant());
  });
});

describe('errors：AppError 基座契约', () => {
  it('构造参数逐项落位，且是 Error 子类', () => {
    const err = new AppError(
      'boom',
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'E_X',
      { k: 1 }
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.category).toBe(ErrorCategory.VALIDATION);
    expect(err.severity).toBe(ErrorSeverity.LOW);
    expect(err.code).toBe('E_X');
    expect(err.context).toEqual({ k: 1 });
  });

  it('`ErrorCategory` 取值唯一（防复制粘贴漂移）', () => {
    const values = Object.values(ErrorCategory);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('lazySingleton：延迟与单次实例化', () => {
  it('首次属性访问才实例化，且只实例化一次', () => {
    let calls = 0;
    const obj = lazySingleton(() => {
      calls += 1;
      return { value: 42 };
    });
    expect(calls).toBe(0);
    expect(obj.value).toBe(42);
    expect(obj.value).toBe(42);
    expect(calls).toBe(1);
  });

  it('方法经 Proxy 调用时 `this` 指向真实实例', () => {
    const obj = lazySingleton(() => ({
      n: 7,
      getN(): number {
        return this.n;
      },
    }));
    expect(obj.getN()).toBe(7);
  });
});
