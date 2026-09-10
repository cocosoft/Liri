/**
 * package-manifest.ts — 打包「运行产物契约」（唯一事实源，CS01 归一化）
 *
 * 任何打包形态（compile 桌面 / 便携 zip / Tauri sidecar / Docker / 更新包）都应从
 * 本契约取数：externals（bun build 参数）、runtimeDeps（必须随包分发的包）、
 * 缺啥打啥、打啥验啥，杜绝"补丁式升级"再次发生。
 */

export type BuildVariant = 'full' | 'core' | 'personal' | 'pro' | 'enterprise';

export interface ExternalEntry {
  name: string;
  /**
   * external 化成因（避免后人考古 commit）：
   *  - native: 含原生二进制（sharp/@img 等）
   *  - size:   体积过大需运行时裁剪后分发（pdfjs-dist legacy）
   *  - tla:    含 top-level await，bun build --target=bun 无法内联（yoga-layout）
   *  - dynamic-import: 仅在特定变体/功能被动态 import，按需携带（imapflow 等，审计后入列）
   */
  reason: 'native' | 'size' | 'tla' | 'dynamic-import';
  /** --smoke 启动自检实际加载的入口（如 pdfjs 裁剪后主入口指向已删的 modern build，须用 legacy 子路径） */
  smokeImport?: string;
}

export const PACKAGE_MANIFEST = {
  /** 发布默认变体：full = 全量单档（2026-09-10 单档收敛；版本分层由运行时 tier 控制） */
  variant: 'full',
  /** 统一构建入口 */
  entry: 'src/pyapp.ts',
  /** bun build 需 --external 的包（声明型契约，生成编译参数） */
  externals: [
    { name: 'sharp', reason: 'native' },
    { name: 'pdfjs-dist', reason: 'size', smokeImport: 'pdfjs-dist/legacy/build/pdf' },
    { name: 'yoga-layout', reason: 'tla' },
  ] as ExternalEntry[],
} as const;

/** 必须随包分发的白名单（拷贝清单 / 产物校验共用，含递归依赖与 @img/* 平台包） */
export const RUNTIME_DEPS: string[] = PACKAGE_MANIFEST.externals.map(
  (e) => e.name
);

/**
 * 随包携带的系统工具（打包资源契约，2026-09-09 起）
 * 布局统一：<运行根>/ffmpeg/bin/{ffmpeg,ffprobe}[.exe]
 * 运行时解析：media/ffmpeg/toolResolver.ts（内置优先，PATH 兜底）
 */
export const RUNTIME_TOOLS = {
  ffmpeg: { dir: 'ffmpeg/bin', exes: ['ffmpeg', 'ffprobe'] as const },
} as const;

/** --smoke 自检的实际加载入口（默认按包名） */
export const SMOKE_IMPORTS: Record<string, string> = Object.fromEntries(
  PACKAGE_MANIFEST.externals.map((e) => [e.name, e.smokeImport ?? e.name])
);

/** 默认发布变体 */
export const DEFAULT_VARIANT: BuildVariant = PACKAGE_MANIFEST.variant as BuildVariant;

/** 供 bun build 命令行拼接 external 参数（扁平数组，供 spawn 直接使用） */
export const EXTERNAL_BUILD_ARGS: string[] = PACKAGE_MANIFEST.externals.flatMap(
  (e) => ['--external', e.name]
);
