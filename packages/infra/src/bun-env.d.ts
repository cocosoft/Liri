// infra 包的类型环境补充（P6，2026-11-01）
//
// bun 运行时提供 `import.meta.dir`（Node/ESM 无此成员）。app 侧由 `app/tests/bun-test.d.ts`
// 的 `declare global` 提供，但 tests 目录不进本包的编译程序 ⇒ 独立 `tsc -p packages/infra`
// 时缺失（TS2339，且会连带报在经 `@modules/*` 被拉进本程序、同样使用该成员的 app 文件上）。
// 本文件只补这一个成员，**不引 bun-types 主入口**（理由见 `app/scripts/bun-env.d.ts` 头注）。
declare global {
  interface ImportMeta {
    dir: string;
  }
}

export {};
