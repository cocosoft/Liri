// 自动生成的按需加载清单（core 独立包 P2）
// 变体: coding — 编码版 — Personal + LSP + Notebook + 代码分析
// 生成时间: 2026-10-23T15:04:04.702Z
// 勿手改：由 app/scripts/build-variant.ts 按变体重写
//
// 未选中的模块连 import() 字面量都不生成 ⇒ 变体裁剪不依赖 minifier 的副作用分析。
export const LAZY_LOADERS: Record<string, () => Promise<unknown>> = {
  featureflags: () => import('@modules/featureflags'),
  memory: () => import('@modules/memory'),
  chronos: () => import('@modules/chronos'),
  lsp: () => import('@modules/lsp'),
  mcp: () => import('@modules/mcp'),
  security: () => import('@modules/security'),
  sandbox: () => import('@modules/sandbox'),
  voice: () => import('@modules/voice'),
  ink: () => import('@modules/ink'),
  ui: () => import('@modules/ui'),
};
