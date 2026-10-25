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
import type { ConfigValidationResult } from '../management/PluginConfigManager';

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
  setConfigValue(
    pluginId: string,
    key: string,
    value: unknown
  ): ConfigValidationResult;
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
      const result = manager.setConfigValue(pluginId, key, value);
      return {
        ok: result.valid,
        errors: result.errors.map((e) => `${e.key}: ${e.message}`),
      };
    },
  };
}

/**
 * 解析**全局唯一**的配置端口。
 *
 * 为什么是动态导入：`plugins/index.ts` 静态依赖 `PluginLoader`，而 `PluginLoader` 是
 * 本模块的调用方 ⇒ 静态反向导入会成环。与仓内既有 `getHotloadManagerLazy()` 同手法。
 *
 * 返回 `null` 仅当插件系统未导出配置管理器（理论上不会发生）；调用方据此**不注入**
 * 配置快照 ⇒ 子进程退回 no-op 实现（fail-closed：宁可读不到，也不另建一个存储）。
 */
export async function resolvePluginConfigPort(): Promise<PluginConfigPort | null> {
  const mod: unknown = await import('../index.js');
  const system = (mod as { pluginSystem?: unknown }).pluginSystem;
  if (!system || typeof system !== 'object') return null;
  const getter = (system as { getConfigManager?: unknown }).getConfigManager;
  if (typeof getter !== 'function') return null;
  const manager = (getter as () => unknown).call(system);
  if (
    !manager ||
    typeof manager !== 'object' ||
    typeof (manager as PluginConfigManagerLike).getConfig !== 'function' ||
    typeof (manager as PluginConfigManagerLike).setConfigValue !== 'function'
  ) {
    return null;
  }
  return pluginConfigPortFromManager(manager as PluginConfigManagerLike);
}
