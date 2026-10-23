/**
 * variant-matrix.ts — 构建变体矩阵的**单一事实源**（P0，2026-10-20）
 *
 * 为什么单独一张表：此前变体定义只存在于 `build-variant.ts` 的局部常量里，
 * 而"变体能力面"的其它读者（校验门禁、文档、后续 `VARIANT_MATRIX` 消费者）
 * 只能各抄一份 ⇒ 加变体即漂移。本文件是**唯一真源**，`build-variant.ts` 只做
 * "读表 → 生成 flags"，不再自带第二份定义。
 *
 * 与既有机制的关系：
 * - `features` / `excludeFeatures` 生成为 `src/bootstrap/generatedVariantFlags.ts`
 *   （`BUILD_VARIANT_FLAGS`），被 `core/featureFlags.ts` 的 `feature()` 作为**中间层**消费；
 * - `buildFeatures` 是**编译期**裁剪（`bun build --feature=...`，物理删除分支）。
 *
 * ⚠️ `buildFeatures` 只允许 `DROP_` 前缀：当前 **`core` 绑定 `DROP_CHANNELS_ALL`**
 *（2026-10-20 用户裁定「core 绝对不含通道」，见其条目内注释），其余变体为空 ——
 * 裁剪是**显式 opt-in**，未声明即全量保留（默认零行为变更）。
 */

/** 变体名（顺序即"能力从少到多"；`headless` 是有意追加的服务端形态） */
export type BuildVariant =
  | 'core'
  | 'personal'
  | 'coding'
  | 'enterprise'
  | 'headless';

/** 合法变体清单（唯一真源；CLI 校验与文档均取自此） */
export const BUILD_VARIANTS: readonly BuildVariant[] = [
  'core',
  'personal',
  'coding',
  'enterprise',
  'headless',
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
 * personal 的能力面 —— **headless 复用同一份**（2026-10-20 用户裁定：
 * headless 继承 personal），避免"两份数组"日后漂移。
 */
const PERSONAL_SPEC: VariantSpec = {
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
};

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
  personal: PERSONAL_SPEC,
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
  // 2026-10-20 用户裁定：headless **继承 personal** 的能力面；
  // 仅构建期剔除 UI（`DROP_UI`），**不裁通道**（默认打包，可用 CLI 追加 DROP_CHANNELS_ALL）。
  headless: {
    ...PERSONAL_SPEC,
    description:
      '无界面服务端版 — 与 personal 同能力面，构建期剔除 UI（DROP_UI），通道默认保留',
    buildFeatures: ['DROP_UI'],
  },
};
