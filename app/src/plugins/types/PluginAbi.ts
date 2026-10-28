/**
 * 统一 **Plugin ABI**（三档共用）—— 方案 §8.5（P4-4，2026-10-28）
 *
 * ## 为什么需要一份"统一 ABI"，而不是再写一套类型
 * 仓库里已有三处插件形状：`types/Plugin.ts` 的 `PluginMetadata`（开发者 API）、
 * `types/PluginMetadata.ts` 的扩展元数据（贡献点清单）、`utils/schemas.ts` 的 zod 清单校验。
 * 它们描述的是**同一个东西的不同切片**，却各自演进 ⇒ "这个插件属于哪一档 / 能不能卸载 /
 * 它依赖谁"没有**单一可判定来源**（正是 §8.4 顺序红线要避免的局面：先开门、后装锁）。
 *
 * 本文件只定义**授权判定所需的最小面**，供三档共用：
 *   - 第 1 档（不可插件化，boot manifest）：`tier: 1` —— 无依赖、不可卸载；
 *   - 第 2 档（内置可禁用）：`tier: 2` —— 随包分发、不可卸载；
 *   - 第 3 档（真外挂）：`tier: 3` —— 必须可卸载（可隔离）。
 *
 * ## 三条硬约束（§8.5）如何落成**可判定**规则
 * ① `contextProviders` **只能贡献，不能改 L0 系统提示**：`contributes` 是**封闭键集**，
 *    任何额外键（`systemPrompt` / `promptOverride` / `l0` …）⇒ `unknown-contribution-kind`
 *    —— 从结构上让"改 L0"无法被表达，而不是靠调用方自觉。
 * ② `channels` 必须**自报桥接事件白名单**：`bridgeEvents` 为空 ⇒ `channel-without-events`
 *    （现状是宿主硬编码 3 个事件，插件无法声明自己的）。
 * ③ `requires` 非空 ⇒ **不得**进第 1 档：`tier1-requires-nonempty`。
 *
 * ⚠️ 接线状态（如实标注）：本 ABI 目前是**契约先行** —— 第 3 档插件入口（`PluginLoader` /
 * `Plugify`）尚未按此校验，接线与"拒载"行为留待 P5（见方案附录 D.5）。在此之前它由
 * `app/tests/plugins/pluginAbi.test.ts` 的判定表钉住，避免定义漂移。
 */

/** 插件档位（§8.5）：1 = 不可插件化 · 2 = 内置可禁用 · 3 = 真外挂 */
export type PluginTier = 1 | 2 | 3;

/** 通道贡献：必须自报桥接事件白名单（硬约束②） */
export interface PluginChannelContribution {
  /** 通道 id（与 `channels/**` 注册表的 `channelId` 同域） */
  channelId: string;
  /**
   * 该通道需要宿主桥接的事件名（**自报**）。
   *
   * 现状：`ChannelEventBus` 只桥 3 个事件且**硬编码**（§8.3）⇒ 插件通道无法表达自己的需要。
   */
  bridgeEvents: readonly string[];
}

/**
 * 贡献点（**封闭键集**，硬约束①）。
 *
 * ⚠️ 不得新增"能改写 L0 系统提示"的键：系统提示的固化段由 `PromptVersionManager` 单一持有，
 * 插件只能**贡献**条目（`contextProviders` 的 id），不能替换/追加系统提示本身。
 */
export interface PluginContributions {
  tools?: readonly string[];
  commands?: readonly string[];
  channels?: readonly PluginChannelContribution[];
  contextProviders?: readonly string[];
}

/** 统一 Plugin ABI（三档共用） */
export interface PluginAbi {
  /** 全局唯一 id（`@scope/name` 允许） */
  id: string;
  /** 语义化版本 */
  version: string;
  /** 档位 */
  tier: PluginTier;
  /** 是否可卸载（tier 1/2 必须 `false`；tier 3 必须 `true`） */
  uninstallable: boolean;
  /** 依赖（插件 id 或内核服务名）；非空 ⇒ 不得进第 1 档（硬约束③） */
  requires: readonly string[];
  /** 贡献点 */
  contributes: PluginContributions;
}

/** 校验问题码（稳定可断言，勿改字面量） */
export type PluginAbiIssueCode =
  | 'missing-id'
  | 'missing-version'
  | 'invalid-tier'
  | 'tier1-uninstallable'
  | 'tier1-requires-nonempty'
  | 'tier2-uninstallable'
  | 'tier3-not-uninstallable'
  | 'channel-without-events'
  | 'unknown-contribution-kind';

export interface PluginAbiIssue {
  code: PluginAbiIssueCode;
  message: string;
}

/** `contributes` 的**封闭**键集（硬约束①：多一个键都不行） */
const ALLOWED_CONTRIBUTION_KEYS: ReadonlySet<string> = new Set([
  'tools',
  'commands',
  'channels',
  'contextProviders',
]);

/**
 * 校验 ABI（**纯函数**；返回问题清单，空数组 = 合规）。
 *
 * fail-closed：`tier` 非法 / 贡献点出现未登记键 ⇒ 判问题，而不是"忽略未知字段"。
 */
export function validatePluginAbi(abi: PluginAbi): PluginAbiIssue[] {
  const issues: PluginAbiIssue[] = [];

  if (!abi.id || abi.id.trim().length === 0) {
    issues.push({ code: 'missing-id', message: '插件 id 不能为空' });
  }
  if (!abi.version || abi.version.trim().length === 0) {
    issues.push({ code: 'missing-version', message: '插件 version 不能为空' });
  }

  if (abi.tier !== 1 && abi.tier !== 2 && abi.tier !== 3) {
    issues.push({
      code: 'invalid-tier',
      message: `非法档位：${String(abi.tier)}（只允许 1 / 2 / 3）`,
    });
    return issues;
  }

  if (abi.tier === 1 && abi.uninstallable) {
    issues.push({
      code: 'tier1-uninstallable',
      message: '第 1 档（boot manifest）不可卸载',
    });
  }
  if (abi.tier === 1 && abi.requires.length > 0) {
    issues.push({
      code: 'tier1-requires-nonempty',
      message: `第 1 档不得有依赖（发现：${abi.requires.join('、')}）`,
    });
  }
  if (abi.tier === 2 && abi.uninstallable) {
    issues.push({
      code: 'tier2-uninstallable',
      message: '第 2 档随包分发 ⇒ 不可卸载（只能禁用）',
    });
  }
  if (abi.tier === 3 && !abi.uninstallable) {
    issues.push({
      code: 'tier3-not-uninstallable',
      message: '第 3 档（真外挂）必须可卸载',
    });
  }

  for (const key of Object.keys(abi.contributes)) {
    if (!ALLOWED_CONTRIBUTION_KEYS.has(key)) {
      issues.push({
        code: 'unknown-contribution-kind',
        message:
          `未登记的贡献点：${key}（只允许 tools / commands / channels / contextProviders；` +
          '插件不得改写 L0 系统提示）',
      });
    }
  }

  for (const channel of abi.contributes.channels ?? []) {
    if (channel.bridgeEvents.length === 0) {
      issues.push({
        code: 'channel-without-events',
        message: `通道 ${channel.channelId} 未自报桥接事件白名单`,
      });
    }
  }

  return issues;
}
