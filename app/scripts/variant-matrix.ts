/**
 * variant-matrix.ts — 构建变体矩阵的**单一事实源**（P0，2026-10-20）
 *
 * 为什么单独一张表：此前变体定义只存在于 `build-variant.ts` 的局部常量里，
 * 而"变体能力面"的其它读者（校验门禁、文档、后续 `VARIANT_MATRIX` 消费者）
 * 只能各抄一份 ⇒ 加变体即漂移。本文件是**唯一真源**，`build-variant.ts` 只做
 * "读表 → 生成 flags"，不再自带第二份定义。
 *
 * 与既有机制的关系：
 * - `features` / `excludeFeatures` 生成为 `src/core/buildVariantFlags.ts`
 *   （`BUILD_VARIANT_FLAGS`），被 `core/featureFlags.ts` 的 `feature()` 作为**中间层**消费；
 * - `buildFeatures` 是**编译期**裁剪（`bun build --feature=...`，物理删除分支）。
 *
 * ⚠️ `buildFeatures` 当前全部为空：`DROP_CHANNELS_ALL` 仍只作**构建设置**、不绑变体
 * （内核瘦身方案 §6-D3）。是否把 core 绑定 `DROP_CHANNELS_ALL` 属待裁定项
 * （变体矩阵方案 §9-1），裁定前不得在此预填。
 */

/** 变体名（顺序即"能力从少到多"） */
export type BuildVariant = 'core' | 'personal' | 'coding' | 'enterprise';

/** 合法变体清单（唯一真源；CLI 校验与文档均取自此） */
export const BUILD_VARIANTS: readonly BuildVariant[] = [
  'core',
  'personal',
  'coding',
  'enterprise',
];

export interface VariantSpec {
  /** 人读描述（写入生成文件的头注释） */
  description: string;
  /** 运行时**开启**的能力开关（生成为 `NAME: true`） */
  features: readonly string[];
  /** 运行时**关闭**的能力开关（生成为 `NAME: false`） */
  excludeFeatures: readonly string[];
  /** 编译期裁剪（`bun build --feature=NAME`；必须 `DROP_` 前缀） */
  buildFeatures: readonly string[];
  /**
   * 工具面是否收敛为 **7 项下限**（生成 `CORE_MINIMAL`）。
   * 仅 `core` 为 true；装配点在 `tools/utils/ToolManagerUtils.ts`（工具实现内部不自审）。
   */
  minimalToolSurface: boolean;
}

/**
 * 变体矩阵。
 *
 * ⚠️ 数组顺序会影响生成文件的行序 —— `build:dry-run` 的"逐字一致"验收依赖它，
 * 调整顺序属**可见变更**，需同步更新验收基线。
 */
export const VARIANT_MATRIX: Record<BuildVariant, VariantSpec> = {
  core: {
    description: '核心版 — 最小功能集，仅 CLI + 7 个基础工具',
    features: [
      'BASH',
      'FILE_READ',
      'FILE_WRITE',
      'FILE_EDIT',
      'GREP',
      'GLOB',
      'ASK',
    ],
    excludeFeatures: [
      'WEB_FETCH',
      'WEB_SEARCH',
      'TASK',
      'TODO',
      'AGENT',
      'AGENT_TRIGGERS',
      'ENABLE_PLUGINS',
      'ENABLE_SKILLS',
      'MCP_SYSTEM',
      'LSP',
      'NOTEBOOK',
      'BROWSER',
      'CODE_ANALYSIS',
      'TEAM_CREATE',
      'TEAM_DELETE',
      'SEND_MESSAGE',
      'FILE_CONVERTER',
      'CHRONOS',
      'TUNGSTEN',
      'PLAN',
      'BRIEF',
    ],
    // 2026-10-20 用户裁定：core **绝对不含通道** ⇒ 构建期物理剔除整组通道
    // （实测 46.61 → 38.85 MB，−16.7%；`@larksuiteoapi` 与 4 个通道标记全消失）。
    buildFeatures: ['DROP_CHANNELS_ALL'],
    minimalToolSurface: true,
  },
  personal: {
    description: '个人版 — Core + Telegram/Web 通道 + 插件 + 文件转换',
    features: [
      'AGENT',
      'ENABLE_PLUGINS',
      'ENABLE_SKILLS',
      'MCP_SYSTEM',
      'FILE_CONVERTER',
      'PLAN',
      'BRIEF',
      'CHRONOS',
      'TUNGSTEN',
    ],
    excludeFeatures: [
      'AGENT_TRIGGERS',
      'LSP',
      'NOTEBOOK',
      'BROWSER',
      'CODE_ANALYSIS',
      'TEAM_CREATE',
      'TEAM_DELETE',
    ],
    buildFeatures: [],
    minimalToolSurface: false,
  },
  coding: {
    description: '编码版 — Personal + LSP + Notebook + 代码分析',
    features: [
      'LSP',
      'NOTEBOOK',
      'CODE_ANALYSIS',
      'BROWSER',
      'TEAM_CREATE',
      'TEAM_DELETE',
    ],
    excludeFeatures: ['AGENT_TRIGGERS'],
    buildFeatures: [],
    minimalToolSurface: false,
  },
  enterprise: {
    description:
      '企业版 — Coding + Slack/Discord + Auth + Audit + Sandbox + Office',
    features: [
      'AGENT_TRIGGERS',
      'SEND_MESSAGE',
      'COORDINATOR_MODE',
      'DOC_MODULE',
      'DOC_TEMPLATE',
      'MAIL_MODULE',
      'CALENDAR_MODULE',
    ],
    excludeFeatures: [],
    buildFeatures: [],
    minimalToolSurface: false,
  },
};
