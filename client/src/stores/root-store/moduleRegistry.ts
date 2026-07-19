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
    paths: ["/media", "/image", "/video", "/tts"],
  });

  store.registerModule({
    id: "office",
    type: "office",
    name: "办公",
    icon: "file-text",
    enabled: true,
    available: true,
    pinned: false,
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
    paths: ["/knowledge", "/files"],
  });

  logger.info("内置模块注册完成", { count: 6 });
}
