/**
 * js-yaml 最小类型声明（infra 包内与 app 共用）
 *
 * 背景：`js-yaml@4` **未内置类型**（只有 `@types/js-yaml`）。`config` 迁入 `packages/infra` 后，
 * 包内文件既不在 `app/node_modules` 之下（运行期需包内 tsconfig 的 `paths` 指向真实包），
 * 该 `paths` 又会让 tsc 走 JS 解析（TS7016）——`@types` 与真实包在同一配置下无法两全。
 *
 * 处置：在包内 `src/types/` 保留**与 `@types/js-yaml` 同形**的最小声明（`load` / `dump` / 默认导出），
 * 由 app 与包两侧程序共同纳入（app tsconfig 的 `include` 显式带上本目录）。
 * 与 `@types/js-yaml` 的差异仅限本项目**未使用**的选项类型（`LoadOptions` / `DumpOptions` 以 `unknown` 代替）。
 */
declare module 'js-yaml' {
  export function load<T = unknown>(input: string, options?: unknown): T;
  export function dump(value: unknown, options?: unknown): string;

  const yaml: {
    load: typeof load;
    dump: typeof dump;
  };
  export default yaml;
}
