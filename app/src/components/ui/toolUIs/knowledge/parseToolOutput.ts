// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 解析工具输出 —— 知识工具 UI 渲染器的统一解析入口。
 *
 * 此前 7 个工具 UI（tools 目录下各工具）各自实现 parseOutput 且数组分支不一致
 * （仅 Search 处理了数组输入），此处收敛为单一实现：
 * - string → JSON.parse（失败返回 {}，不吞错误信息之外的细节）
 * - 数组/对象 → 原样返回
 *
 * 注意：工具 result 既可能是数组（如 snapshots 的文件名数组、delete 的候选列表），
 * 也可能是对象，调用方需自行 Array.isArray 判断。
 */
export function parseToolOutput(output: unknown): unknown {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output);
    } catch {
      return {};
    }
  }
  return output ?? {};
}
