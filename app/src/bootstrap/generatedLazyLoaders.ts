// 自动生成的按需加载清单（core 独立包 P2）
// 变体: default（全量）—— 未跑 `build-variant.ts` 时的开发默认值
// 勿手改：由 app/scripts/build-variant.ts 按变体重写
//
// 未选中的模块连 import() 字面量都不生成 ⇒ 变体裁剪不依赖 minifier 的副作用分析。

export const LAZY_LOADERS: Record<string, () => Promise<unknown>> = {
  featureflags: () => import('@modules/featureflags'),
  memory: () => import('@modules/memory'),
  chronos: () => import('@modules/chronos'),
  lsp: () => import('@modules/lsp'),
  mcp: () => import('@modules/mcp'),
  ink: () => import('@modules/ink'),
  ui: () => import('@modules/ui'),
  security: () => import('@modules/security'),
  sandbox: () => import('@modules/sandbox'),
  voice: () => import('@modules/voice'),
};
