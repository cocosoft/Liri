// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 组合根注入包的**惰性门面**（2026-11-24，R00-003 收口）。
 *
 * 背景：`CoreAPIImpl`（service 层）不得静态依赖 app 层，原先若干方法在 service 侧
 * `await import('@modules/…')` ⇒ 形成静态正则看不见的跨层盲区（R00-003）。
 * 现把"取值"下沉为 `CoreApiAppDeps`（D-227 既有缝），由**入口层**装配注入。
 *
 * 本文件把这些门面的**实现**集中一处：
 * - `registerCoreApiAppDeps()`（`BootPipelineIntegrator`）用它装配；
 * - 直接调用 handler 的契约测试也可用同一实现构造 deps（避免测试里复制一份门面逻辑）。
 *
 * ⚠️ 全部是**每次调用再 `import()`**：保持原先"按叶子加载"的时机 —— 既不在启动期拉起重依赖，
 * 也不把 dream/skills 这类整条桶面带进 HTTP 冷路径。
 */

import type { AutoReplyPort } from '@openliri/service/runtime/api/autoReplyPorts';
import type { BuddyOpsPort } from '@openliri/service/runtime/api/buddyOpsPorts';
import type { CommandsOpsPort } from '@openliri/service/runtime/api/commandsOpsPorts';

/** 命令端口工厂（`CoreApiAppDeps.commandsOps`） */
export function createCommandsOpsFacade(): (
  chatManager?: unknown
) => CommandsOpsPort {
  return (chatManager?: unknown) => ({
    listCommands: async () => {
      const { getCommandManager } = await import('@modules/commands');
      return getCommandManager().getAllCommands();
    },
    executeCommand: async (command: string, sessionId?: string) => {
      const { commandExecutor } =
        await import('@modules/commands/executor/CommandExecutor.js');
      // 2026-10-22：会话级命令需要 `context.sessionId` + `context.chatManager`
      // （如 brief 取本会话消息）；未传时保持旧的"空 context"调用形态。
      const context: Parameters<typeof commandExecutor.execute>[1] = {};
      if (sessionId) context.sessionId = sessionId;
      if (chatManager) context.chatManager = chatManager as never;
      return commandExecutor.execute(command, context);
    },
  });
}

/** 知识库文档 provider 门面（`CoreApiAppDeps.knowledgeDocsProvider`） */
export function createKnowledgeDocsFacade() {
  return {
    buildIndex: async () => {
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');
      return knowledgeDocsProvider.buildIndex();
    },
    clearCache: async () => {
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');
      knowledgeDocsProvider.clearCache();
    },
  };
}

/** 梦境运维门面（`CoreApiAppDeps.dreamOps`） */
export function createDreamOpsFacade() {
  return {
    listCycles: async (params: unknown) => {
      const dreamPersistence = await import('@modules/dream/DreamPersistence');
      return new dreamPersistence.DreamPersistence().listCycles(
        params as never
      );
    },
    queryCycles: async (filter: unknown) => {
      const { getDreamCycleDb } = await import('@modules/dream/DreamCycleDb');
      const db = await getDreamCycleDb();
      const [cycles, stats] = await Promise.all([
        db.queryCycles(filter as never),
        db.aggregateCycles(filter as never),
      ]);
      return { cycles, stats };
    },
    getCycle: async (cycleId: string) => {
      const dreamPersistence = await import('@modules/dream/DreamPersistence');
      return new dreamPersistence.DreamPersistence().getCycle(cycleId);
    },
    readMetrics: async () => {
      const { readMetrics } = await import('@modules/dream/DreamMetrics');
      return readMetrics();
    },
  };
}

/** 自动回复运行时门面（`CoreApiAppDeps.autoReplyOps`） */
export function createAutoReplyOpsFacade(): () => Promise<AutoReplyPort> {
  return async () => {
    // ⚠️ `auto-reply` 模块**无 `@modules/*` 别名**（tsconfig 逐模块显式声明）
    // ⇒ 入口层用相对路径导入（原 service 侧同样只能走相对路径）。
    const { autoReplyEngine } = await import('../auto-reply/index.js');
    return {
      getAllRules: () => autoReplyEngine.getAllRules(),
      getStats: () => autoReplyEngine.getStats(),
      registerRule: (rule) => autoReplyEngine.registerRule(rule as never),
      updateRule: (ruleId, updates) =>
        autoReplyEngine.updateRule(ruleId, updates as never),
      deleteRule: (ruleId) => autoReplyEngine.deleteRule(ruleId),
    };
  };
}

/** Buddy 运维门面（`CoreApiAppDeps.buddyOps`） */
export function createBuddyOpsFacade(): () => BuddyOpsPort {
  return () => {
    /** `@modules/buddy` barrel 与子模块取用 */
    const buddyModule = async () => import('@modules/buddy');
    const dreamLogStore = async () => import('@modules/buddy/dreamLogStore');

    return {
      // 2026-11-25 契约收口 A：返回「伙伴快照」（骨骼/灵魂 + 由累计经验派生的
      // level/experience/experienceToNext）⇒ 前端不再出现 undefined/NaN
      getBuddyCompanion: async () =>
        (await buddyModule()).getCompanionSnapshot(),
      executeBuddyInteraction: async (companion: unknown, action: string) => {
        const { InteractionManager, recordBuddyInteraction } =
          await buddyModule();
        const manager = new InteractionManager();
        // companion 为 getBuddyCompanion 回传的**真对象** ⇒ 边界收窄；
        // action 原为字面量联合（原码直接透传）⇒ 边界收窄；
        // 返回值以 Record 暴露（调用方需展开/JSON）⇒ 同上（app interface 无隐式索引签名）
        const result = (await manager.execute(
          companion as never,
          action as never
        )) as never;
        // 服务端记账（互动次数 + 经验）——与梦境/任务同一真源（buddy-growth.json）
        await recordBuddyInteraction();
        return result;
      },
      // 下列 4 处同样以 Record 暴露（调用方展开 / 仅 JSON）⇒ 边界收窄
      getBuddyDreamStats: async () =>
        (await dreamLogStore()).getDreamStats() as never,
      getBuddyDreamLogs: async (limit: number, offset?: number | undefined) =>
        (await dreamLogStore()).getDreamLogs(limit, offset) as never,
      getBuddyDreamLogsByType: async (
        type: string,
        limit: number,
        offset?: number | undefined
      ) =>
        // type 原为字面量联合（原码 `as any`）⇒ 边界收窄
        (await dreamLogStore()).getDreamLogsByType(
          type as never,
          limit,
          offset
        ) as never,
      loadBuddyGrowthState: async () =>
        (
          await import('@modules/buddy/growthPersistence')
        ).loadGrowthState() as never,
    };
  };
}
