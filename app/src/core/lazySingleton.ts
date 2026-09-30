/**
 * 懒加载单例（**纯 HOF**）—— core 侧共享实现。
 *
 * 2026-09-30 由 infra 层（`utils/common.ts`）下沉至 core（G2 分层倒挂收口）：
 * 原实现被 core 侧 `core/Coordinator` 直接引用，构成 core → infra 倒挂
 * （A 类台账，见 .trae/specs/layer-inversion-a-class-inventory.md §3.5.1）。
 * 本文件零依赖（置于模块根，跨模块消费方按 2 段路径直连，避免 R03-002 子目录导入）；
 * `utils/common.ts` 保留同名转出 ⇒ `@modules/utils` 对外导出不变。
 */

/**
 * 创建懒加载单例 — 通过 Proxy 延迟实例化，首次访问属性时才创建
 * @param factory 实例工厂函数
 * @returns Proxy 包装的实例
 */
export function lazySingleton<T extends object>(factory: () => T): T {
  let instance: T | null = null;

  return new Proxy({} as T, {
    get(_, prop: string | symbol, receiver: unknown) {
      if (!instance) instance = factory();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_, prop: string | symbol, value: unknown, receiver: unknown) {
      if (!instance) instance = factory();
      return Reflect.set(instance, prop, value, receiver);
    },
    has(_, prop: string | symbol) {
      if (!instance) instance = factory();
      return Reflect.has(instance, prop);
    },
    ownKeys() {
      if (!instance) instance = factory();
      return Reflect.ownKeys(instance);
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (!instance) instance = factory();
      return Reflect.getOwnPropertyDescriptor(instance, prop);
    },
  });
}
