/**
 * 模块注册 — 将现有页面组件注册到 FeatureSlice
 *
 * 新模块只需在此调用 registerModule()，无需修改 ViewRouter 或路由表。
 */

import { useRootStore } from "@/stores/root-store";
import { createLogger } from "@/utils/logger";

const logger = createLogger("modules:register");

/** 注册所有内置模块到 FeatureSlice */
export function registerBuiltinModules(): void {
  const store = useRootStore.getState();

  store.registerModule({
    id: "chat",
    type: "chat",
    name: "对话",
    icon: "message-circle",
    enabled: true,
    available: true,
    pinned: true,
    tier: "base",
    paths: ["/chat"],
  });

  store.registerModule({
    id: "media",
    type: "media",
    name: "媒体",
    icon: "image",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
    paths: ["/media", "/image", "/tts"],
  });

  store.registerModule({
    id: "office",
    type: "office",
    name: "办公",
    icon: "file-text",
    enabled: true,
    available: true,
    pinned: false,
    tier: "pro",
    paths: ["/office"],
  });

  store.registerModule({
    id: "calendar",
    type: "calendar",
    name: "日历",
    icon: "calendar",
    enabled: true,
    available: true,
    pinned: false,
    tier: "pro",
    paths: ["/calendar"],
  });

  store.registerModule({
    id: "translation",
    type: "translation",
    name: "翻译",
    icon: "languages",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
    paths: ["/translate"],
  });

  store.registerModule({
    id: "knowledge",
    type: "knowledge",
    name: "知识库",
    icon: "book-open",
    enabled: true,
    available: true,
    pinned: false,
    tier: "base",
    paths: ["/knowledge", "/files"],
  });

  logger.info("内置模块注册完成", { count: 6 });
}

// ─── 模块元信息（归一化入口：icon + label + workspaceType 唯一来源）───

const MODULE_EMOJI_META: Record<
  string,
  { emoji: string; label: string; workspaceType: string }
> = {
  chat: { emoji: "💬", label: "对话", workspaceType: "chat" },
  media: { emoji: "🎨", label: "媒体", workspaceType: "module" },
  office: { emoji: "📄", label: "办公", workspaceType: "module" },
  calendar: { emoji: "📅", label: "日历", workspaceType: "module" },
  translation: { emoji: "🌐", label: "翻译", workspaceType: "module" },
  knowledge: { emoji: "📚", label: "知识库", workspaceType: "module" },
};

/** 获取模块的 emoji 图标和中文标签（会话列表、标题等场景使用） */
export function getModuleMeta(type: string): { emoji: string; label: string } {
  const m = MODULE_EMOJI_META[type];
  return m ? { emoji: m.emoji, label: m.label } : { emoji: "📋", label: type };
}

/** 获取模块中文标签（创建默认会话标题等场景使用） */
export function getModuleLabel(type: string): string {
  return MODULE_EMOJI_META[type]?.label ?? type;
}

/** 获取模块的 workspaceType */
export function getModuleWorkspaceType(type: string): "module" | "chat" {
  return (
    (MODULE_EMOJI_META[type]?.workspaceType as "module" | "chat") ?? "module"
  );
}

/** 所有系统模块类型列表 */
export const MODULE_TYPES = Object.keys(MODULE_EMOJI_META);
