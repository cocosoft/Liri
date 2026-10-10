/**
 * SPI 装配顺序守卫（P1-7 · `dev_docs/20261010/升级优化方案-20261010.md` §3）
 *
 * **问题**：部分端口的装配顺序是**隐式约束**（如 `Knowledge` 的实现在装配期经
 * `resolveAiAccess().getAiService()` 取 `AiAccess` 的实例）—— 此前**仅在注释里声明**，
 * 一旦有人调整 `entrypoints/spiWiring.ts` 的顺序，会**晚失败**（调用时才报）甚至**静默降级**
 * （端口代理未注册返回空值 ⇒ 编译/巡检悄悄不干活）。
 *
 * **做法**：把顺序声明为**唯一事实源** + **注册期断言** ——
 * 依赖缺失时**立即抛错并给出可读原因**（启动即失败），而不是留到运行期。
 *
 * 关联：`INV-ARCH-001`（`.trae/architecture/invariant-registry.json`）· `core/spi/README.md`
 */

/** 已注册端口集合（模块级；由各 `register*Spi` 依次标记） */
const registeredPorts = new Set<string>();

/**
 * 端口装配依赖（**唯一事实源**）：键为端口，值为**必须先注册**的端口。
 *
 * ⚠️ 新增顺序约束时，**必须**在此登记（并在依赖端口的 `register*Spi` 内调用
 * `requireSpiDependencies('<端口>')`）。
 */
export const SPI_WIRING_REQUIRES: Readonly<Record<string, readonly string[]>> =
  {
    // Knowledge 的编译需经 `resolveAiAccess().getAiService()`（见 KnowledgeService.ts 头注）
    knowledge: ['aiAccess'],
  };

/** 标记端口已注册（由各 `register*Spi` 调用） */
export function markSpiRegistered(port: string): void {
  registeredPorts.add(port);
}

/** 端口是否已注册（供装配自检与测试） */
export function isSpiRegistered(port: string): boolean {
  return registeredPorts.has(port);
}

/** 测试用：清空注册记录（避免跨用例串扰） */
export function resetSpiRegistryForTest(): void {
  registeredPorts.clear();
}

/**
 * 断言某端口的**全部装配依赖已就绪**；缺失 ⇒ **显式抛错**（启动即失败 + 可读原因）。
 *
 * 抛错而非降级：装配顺序错误属**开发期缺陷**（非运行期可恢复态），静默降级会掩盖它
 * （CS03：不得用回退掩盖错误）。
 */
export function requireSpiDependencies(port: string): void {
  const needs = SPI_WIRING_REQUIRES[port] ?? [];
  const missing = needs.filter((p) => !registeredPorts.has(p));
  if (missing.length > 0) {
    throw new Error(
      `[SPI 装配顺序] '${port}' 依赖 ${missing
        .map((m) => `'${m}'`)
        .join(
          ', '
        )}，但尚未注册 —— 请在 \`entrypoints/spiWiring.ts\` 中**先装配**该端口` +
        `（顺序契约见 core/spi/wiringGuard.ts 的 SPI_WIRING_REQUIRES）`
    );
  }
}
