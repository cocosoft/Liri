/**
 * 记忆系统共享类型标签
 * 全项目唯一来源，供 MemoryPage、MemoryList、MemoryWeightChart、MemoryCreateDialog 等使用
 *
 * v1.3: 类型重构 — 对齐语义正确的前后端映射
 */

import i18n from "@/i18n";
import type { MemoryType } from "../../services/memoryService";

export const TYPE_LABELS: Record<MemoryType, string> = {
  user_identity: i18n.t("memory.typeUserIdentity"),
  user_preference: i18n.t("memory.typeUserPreference"),
  project_context: i18n.t("memory.typeProjectContext"),
  knowledge: i18n.t("memory.typeKnowledge"),
  system_instruction: i18n.t("memory.typeSystemInstruction"),
};

export const TYPE_OPTIONS: { value: MemoryType; label: string }[] = [
  { value: "user_identity", label: i18n.t("memory.typeUserIdentity") },
  { value: "user_preference", label: i18n.t("memory.typeUserPreference") },
  { value: "project_context", label: i18n.t("memory.typeProjectContext") },
  { value: "knowledge", label: i18n.t("memory.typeKnowledge") },
  {
    value: "system_instruction",
    label: i18n.t("memory.typeSystemInstruction"),
  },
];

export const TYPE_COLORS: Record<MemoryType, string> = {
  user_identity:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  user_preference:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  project_context:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  knowledge:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  system_instruction:
    "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

export const TYPE_CHART_COLORS: Record<MemoryType, string> = {
  user_identity: "#6366F1",
  user_preference: "#3B82F6",
  project_context: "#10B981",
  knowledge: "#F59E0B",
  system_instruction: "#6B7280",
};
