/** `native/loaderPaths.js` 的类型声明（供 TS 侧单测导入） */
export declare function nativeLibName(
  platform: string,
  suffix: string
): string;

/** 平台默认库后缀（`darwin` → dylib · `win32` → dll · 其余 → so） */
export declare function nativeSuffix(platform: string): string;

export declare function nativeLibCandidates(input: {
  platform: string;
  suffix: string;
  dirname: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}): string[];
