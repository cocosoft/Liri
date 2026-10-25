/**
 * 插件**配置能力**（T25-08 P2 · `config`）的宿主侧端口。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P2」——「`config.get/set`（仅插件
 * 自己的命名空间）」。
 *
 * **不新建存储**（CS01）：唯一事实源仍是既有的 `PluginConfigManager`
 * （`~/.pyapp/plugins/config/config.json`，含 schema 校验与默认值）。本文件只做两件事：
 * - 把它的读写收窄成**按 pluginId** 的窄接口（插件只能碰自己的命名空间）；
 * - 提供一个**唯一**的解析入口，保证不会出现第二个 `PluginConfigManager` 实例
 *   —— 两个实例各自 `persistConfigs()` 会用「自己的 Map」覆盖同一个文件 ⇒ 丢别的插件配置。
 */
/** 一次写入的结果（回给子进程，让插件看得见失败原因） */
export interface PluginConfigWriteResult {
  ok: boolean;
  errors: string[];
}

/** 宿主侧配置端口（按 pluginId 收窄；`pluginId` 由宿主传入，插件无法自选） */
export interface PluginConfigPort {
  /** 读该插件的**全量**配置（已合并 schema 默认值；无配置 ⇒ `{}`） */
  read(pluginId: string): Record<string, unknown>;
  /** 写一条（宿主校验 + 落盘；不做部分成功的"猜"） */
  write(pluginId: string, key: string, value: unknown): PluginConfigWriteResult;
}

/** `PluginConfigManager` 中本端口用到的最小面（避免把整个类当契约） */
export interface PluginConfigManagerLike {
  getConfig(pluginId: string): Record<string, unknown>;
  setConfigValue(pluginId: string, key: string, value: unknown): void;
}

/** 适配器（纯组合，无 IO：IO 在 manager 内部） */
export function pluginConfigPortFromManager(
  manager: PluginConfigManagerLike
): PluginConfigPort {
  return {
    read(pluginId) {
      return { ...manager.getConfig(pluginId) };
    },
    write(pluginId, key, value) {
      // 宿主这一层**不做** schema 校验（唯一实现在 `plugins/utils/pluginConfigSchema.ts`）
      // ⇒ 管理器不会拒绝写入，`ok` 恒为 true。
      manager.setConfigValue(pluginId, key, value);
      return { ok: true, errors: [] };
    },
  };
}

/** 管理器提供者（由 `plugins/index.ts` 注入；**不在本模块 import 上层**，否则 madge 判环） */
type ConfigManagerProvider = () => PluginConfigManagerLike | null;

let managerProvider: ConfigManagerProvider | null = null;

/**
 * 注册**全局唯一**配置管理器的提供者。
 *
 * 为什么是"注册"而不是在本模块 `import('../index.js')`：`plugins/index.ts`（经 `PluginLoader`）
 * 静态依赖本模块，反向 import 会形成 `index → PluginLoader → pluginConfigPort → index` 的环
 * —— `lint:circular` 的 madge 会连**动态** `import()` 一起算，当时代码里那条"动态导入避免成环"
 * 的注释与实际行为不符（2026-10-25 CI 实证）。改为 DI：由 `index.ts` 把 getter 传进来。
 */
export function registerPluginConfigManagerProvider(
  provider: ConfigManagerProvider
): void {
  managerProvider = provider;
}

/**
 * 解析**全局唯一**的配置端口。
 *
 * 返回 `null` 当且仅当：
 * - 尚未注册提供者（如只 import 了 `PluginLoader` 而未初始化插件系统）⇒ 调用方不注入配置
 *   ⇒ 插件退回空实现（fail-closed：宁可读不到，也不另建第二个存储）；
 * - 提供者返回空（理论上不会发生）。
 */
export async function resolvePluginConfigPort(): Promise<PluginConfigPort | null> {
  if (!managerProvider) return null;
  const manager = managerProvider();
  return manager ? pluginConfigPortFromManager(manager) : null;
}
