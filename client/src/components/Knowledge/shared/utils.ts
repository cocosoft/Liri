/**
 * 知识库共享工具函数
 *
 * 从 KnowledgePage/KnowledgeBaseList/PendingCompilePanel 三方提取归并。
 */
import i18n from "../../../i18n";
import { currentLocale } from "../../../utils/format";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(ts: number): string {
  if (!ts) return i18n.t("common.unknown");
  return new Date(ts).toLocaleString(currentLocale());
}
