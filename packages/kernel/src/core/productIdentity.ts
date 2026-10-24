/**
 * 产品身份（去产品化 Q3）—— 内核**唯一**允许知道"产品叫什么"的地方。
 *
 * 依据：`dev_docs/20261024/基础设施专项-现状与规划.md` §4.2。
 *
 * **为什么单独成文件（而不是留在 `paths.ts`）**：`ports.ts` 与 `featureFlags.ts` 也需要
 * 派生环境变量键（`<prefix>HTTP_PORT` / `<prefix>BUILD_VARIANT`），而它们属「**零依赖叶子**」
 * —— `http-server.ts` 明确要求「静态依赖仅限 core 的零依赖模块」，若让它们 import
 * `paths.ts` 会把整条内核求值链（logger 门面 / identity / storageScope）拉进启动面。
 * 本文件**零 import** ⇒ 谁都可以安全依赖它。
 *
 * 默认值 = 本仓现有产品身份 ⇒ 未注入时行为逐字不变。
 */

/** 产品身份（宿主可注入） */
export interface ProductIdentity {
  /** 数据目录名（`~/.<appName>`）与产品展示名 */
  appName: string;
  /** 环境变量前缀（不含/含尾部 `_` 均可，注入时自动补齐），如 `LIRI_` */
  envPrefix: string;
}

/** 默认产品身份（= 现有产品，保证零行为变更） */
export const DEFAULT_PRODUCT_IDENTITY: ProductIdentity = {
  appName: 'pyapp',
  envPrefix: 'LIRI_',
};

let productIdentity: ProductIdentity = { ...DEFAULT_PRODUCT_IDENTITY };

/**
 * 注入产品身份（宿主启动最早期调用）
 *
 * 增量覆盖：未传字段保持原值。`envPrefix` 会自动补尾部 `_`。
 * @throws `CORE_PRODUCT_IDENTITY_INVALID` — appName / envPrefix 为空白
 */
export function configureProductIdentity(
  patch: Partial<ProductIdentity>
): void {
  const appName = (patch.appName ?? productIdentity.appName).trim();
  if (!appName) {
    throw new Error('CORE_PRODUCT_IDENTITY_INVALID: appName 不能为空');
  }
  const rawPrefix = (patch.envPrefix ?? productIdentity.envPrefix).trim();
  if (!rawPrefix) {
    throw new Error('CORE_PRODUCT_IDENTITY_INVALID: envPrefix 不能为空');
  }
  productIdentity = {
    appName,
    envPrefix: rawPrefix.endsWith('_') ? rawPrefix : `${rawPrefix}_`,
  };
}

/** 读取当前产品身份 */
export function getProductIdentity(): ProductIdentity {
  return productIdentity;
}

/** 恢复默认产品身份（测试用；宿主无需调用） */
export function resetProductIdentity(): void {
  productIdentity = { ...DEFAULT_PRODUCT_IDENTITY };
}

/**
 * 环境变量键名：`HOME` ⇒ `<envPrefix>HOME`
 *
 * ⚠️ **契约键**（读/写两端必须同键，改前缀必须同批改）：
 * `<prefix>HTTP_PORT` 由内核读（`ports.ts`）、由 `app/src/infrastructure/http/http-server.ts` 写回，
 * 并被 `client/vite.config.ts` · `client/playwright.config.ts` · `app/.env.example` ·
 * `app/docker/{Dockerfile,docker-compose.yml}` 引用。
 */
export function productEnvKey(suffix: string): string {
  return `${productIdentity.envPrefix}${suffix}`;
}

/**
 * **旧版**环境变量键名：`<APPNAME>_<suffix>`（大写 appName）
 *
 * 历史遗留（`PYAPP_PROJECT_DIR`）：仅作 `resolveWorktreeHash` 的回退分支读取，
 * 新代码**不得**新增此类键（见 `.trae/rules/project_rules.md` §1.4 前缀规范）。
 */
export function legacyProductEnvKey(suffix: string): string {
  return `${productIdentity.appName.toUpperCase()}_${suffix}`;
}
