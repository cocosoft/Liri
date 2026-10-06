/**
 * MediaPage 共享类型与格式化纯函数
 *
 * 由 `views/MediaPage.tsx` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §38）：这些类型/函数被宿主与
 * `MediaGridView` 共用 ⇒ 下沉为独立模块（**只搬不改**，逻辑逐字保留）。
 */

/** 筛选类型 */
export type FilterType = "all" | "image" | "video" | "favorites";
/** 排序方式 */
export type SortBy = "date_desc" | "date_asc" | "name";

/** 从 URL 路径提取文件名 */
export function extractFileName(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] || url;
}

/**
 * 长宽比 → 像素 size（长边 1024，8 的倍数对齐）
 * 2026-08-26：图片生成后端 size 为像素格式（如 "1024x576"），
 * 长宽比选择器/自定义比例经此映射后生效
 */
export function ratioToSize(ratio: string): string {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h || w < 1 || h < 1) return "1024x1024";
  const LONG = 1024;
  if (w >= h) {
    const height = Math.max(8, Math.round((LONG * h) / w / 8) * 8);
    return `${LONG}x${height}`;
  }
  const width = Math.max(8, Math.round((LONG * w) / h / 8) * 8);
  return `${width}x${LONG}`;
}

/** 从文件名提取格式 */
export function extractFormat(name: string, fallback: string): string {
  const ext = name.split(".").pop()?.toUpperCase();
  return ext || fallback;
}

/** 从 URL 路径提取日期 */
export function extractDate(url: string): string {
  const match = url.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 格式化时间戳为日期字符串 */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** API 响应中的图片条目 */
export interface ImageApiItem {
  path?: string;
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** API 响应中的视频条目 */
export interface VideoApiItem {
  path?: string;
  url: string;
  duration?: number;
  width?: number;
  height?: number;
}

/** 元数据响应 */
export interface ImageMetadata {
  path: string;
  size: number;
  format: string;
  width: number | null;
  height: number | null;
  createdAt: number;
  modifiedAt: number;
}
