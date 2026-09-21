/**
 * 模块元信息（emoji / 标签 i18n key / workspaceType）
 *
 * 内置模块的**定义**已收敛至 `@/config/builtinModules.ts`（N-8 / N-9），
 * 本文件不再承担注册职责：原 `registerBuiltinModules()` 已删除 —— `featureSlice`
 * 直接以 config 的 `BUILTIN_MODULES` 作为初始 state，无需再"注册 + 叠加 paths"。
 */

// ─── 模块元信息（归一化入口：emoji + labelKey + workspaceType 唯一来源）───
//
// Phase 2（§4.3-6 续，2026-09-19）：原 `label` 硬编码中文改为 `labelKey`，
// 展示侧统一 `t(labelKey)`（否则英文 locale 下模块标签仍显示中文）。
// 键复用导航注册表的 `nav.*`（同一功能一个名称）；calendar / translation 是
// D5/D7（日历并入办公、翻译并入聊天）后为**存量会话标签**保留的键。

const MODULE_EMOJI_META: Record<
  string,
  { emoji: string; labelKey: string; workspaceType: string }
> = {
  chat: { emoji: "💬", labelKey: "nav.chat", workspaceType: "chat" },
  project: { emoji: "📁", labelKey: "nav.projects", workspaceType: "chat" },
  media: { emoji: "🎨", labelKey: "nav.media", workspaceType: "module" },
  office: { emoji: "📄", labelKey: "nav.office", workspaceType: "module" },
  calendar: { emoji: "📅", labelKey: "nav.calendar", workspaceType: "module" },
  translation: {
    emoji: "🌐",
    labelKey: "translate.title",
    workspaceType: "module",
  },
  knowledge: {
    emoji: "📚",
    labelKey: "nav.knowledge",
    workspaceType: "module",
  },
};

/** 获取模块的 emoji 与**标签 i18n key**（会话列表、标题等场景使用，调用方自行 t()） */
export function getModuleMeta(type: string): {
  emoji: string;
  labelKey: string;
} {
  const m = MODULE_EMOJI_META[type];
  return m
    ? { emoji: m.emoji, labelKey: m.labelKey }
    : { emoji: "📋", labelKey: type };
}

/** 获取模块标签 i18n key（未知类型回落为 type 本身） */
export function getModuleLabel(type: string): string {
  return MODULE_EMOJI_META[type]?.labelKey ?? type;
}

/** 获取模块的 workspaceType */
export function getModuleWorkspaceType(type: string): "module" | "chat" {
  return (
    (MODULE_EMOJI_META[type]?.workspaceType as "module" | "chat") ?? "module"
  );
}

/** 所有系统模块类型列表 */
export const MODULE_TYPES = Object.keys(MODULE_EMOJI_META);
