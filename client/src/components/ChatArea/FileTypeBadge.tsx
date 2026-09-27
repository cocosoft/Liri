/**
 * 文件类型徽章组件
 *
 * 根据文件类型显示不同颜色和标签，如：
 * - 代码（蓝色）、文档（紫色）、JSON（琥珀色）
 * - 图片（绿色）、PDF（红色）等
 */
import { useTranslation } from "react-i18next";

/** 需随语言切换的标签（键映射） */
const LABEL_KEYS: Record<string, string> = {
  code: "chat.fileTypeCode",
  markdown: "chat.fileTypeMarkdown",
  image: "chat.fileTypeImage",
  text: "chat.fileTypeText",
  audio: "chat.fileTypeAudio",
  video: "chat.fileTypeVideo",
};

/** 语言中立的格式标签（HTML/JSON/YAML/PDF 等，保持字面量） */
const LABEL_LITERALS: Record<string, string> = {
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
};

function FileTypeBadge({ type }: { type: string }) {
  const { t } = useTranslation();
  const colors: Record<string, string> = {
    code: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    html: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    markdown:
      "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    json: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    yaml: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
    image:
      "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    text: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    pdf: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    docx: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    pptx: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    xlsx: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    audio: "bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400",
    video:
      "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
  };

  const labelKey = LABEL_KEYS[type];
  const label = labelKey
    ? t(labelKey)
    : (LABEL_LITERALS[type] ?? type);

  return (
    <span
      className={`flex-shrink-0 px-1.5 py-0.5 text-xs font-medium rounded ${colors[type] || colors.text}`}
    >
      {label}
    </span>
  );
}

export default FileTypeBadge;
