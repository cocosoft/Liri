/**
 * 前端**自定义事件名**（单一真源 —— 硬编码治理 `HD-P2-3`）。
 *
 * **为什么值得集中**：这些是挂在 `window` 上的**应用私有**事件（区别于 `keydown` / `resize`
 * 等 DOM 原生事件），由**一处 `dispatchEvent`、他处 `addEventListener`** 成对使用：
 * 字面量一旦拼写漂移，**监听方静默不触发**（既无编译期报错、也无运行时报错）⇒ 收口价值高于普通常量。
 *
 * ⚠️ **值不得改动**：任一处改名都会**断掉运行时已配对的双方**。
 */
export const APP_EVENTS = {
  /** 全局速记浮层（`useKeyboard` 派发 → `App` 监听；D-j） */
  openQuickNote: "open-quick-note",
  /** 全局搜索（`Header` / `ChatInput` 派发 → `App` 监听） */
  openGlobalSearch: "open-global-search",
  /** 快捷键帮助浮层（`useKeyboard` 派发 → `KeyboardShortcutsHelp` 监听） */
  toggleShortcutHelp: "toggle-shortcut-help",
  /** 追加知识条目（`KnowledgePage` 派发 → `App` 监听） */
  appendKnowledge: "liri:append-knowledge",
  /** 对话中 AI 生图完成（`chatService` 派发 → `MediaPage` / `useImageGallery` 监听） */
  imageGenerated: "pyapp:image_generated",
  /** 画布重绘（工具栏与各工具派发 → `CanvasSurface` 监听） */
  canvasRender: "canvas-render",
} as const;
