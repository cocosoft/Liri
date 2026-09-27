// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 安全定位横幅（M1，方案 §5.2）
 * 统一标注每个安全功能页所属权限级别（系统边界 / 用户级 / 应用级），
 * 一眼可辨"这块管什么、回答什么问题、与相邻块什么关系"。
 *
 * CS02：`SafetyLayer` 取**语言中立标识**（system/user/app）作判别值，
 * 展示文案一律由 i18n 键提供 —— 禁止用中文文案当判别值
 * （否则切语言时判别失效、且文案一改即类型不匹配）。
 */

import { useTranslation } from "react-i18next";

export type SafetyLayer = "system" | "user" | "app";

/** 权限级别标识 → i18n 键（判别值为语言中立标识，仅渲染时翻译） */
const LAYER_LABEL_KEYS: Record<SafetyLayer, string> = {
  system: "settings.safetyLayerSystem",
  user: "settings.safetyLayerUser",
  app: "settings.safetyLayerApp",
};

interface SafetyPositionBannerProps {
  /** 主级别（可选从属级别） */
  layer: { primary: SafetyLayer; secondary?: SafetyLayer };
  /** 块名：权限 / API 密钥 / ... */
  title: string;
  /** 回答的问题：工具/操作允不允许执行 */
  question: string;
  /** 与相邻块关系：如"系统边界兜底，allow 无法覆盖" */
  relation?: string;
  isDark: boolean;
}

const LAYER_STYLE: Record<SafetyLayer, string> = {
  system: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  user: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  app: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

function SafetyPositionBanner({
  layer,
  title,
  question,
  relation,
  isDark,
}: SafetyPositionBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`mb-4 p-3 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded ${LAYER_STYLE[layer.primary]}`}
        >
          {t(LAYER_LABEL_KEYS[layer.primary])}
        </span>
        {layer.secondary && (
          <>
            <span
              className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              →
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${LAYER_STYLE[layer.secondary]}`}
            >
              {t(LAYER_LABEL_KEYS[layer.secondary])}
            </span>
          </>
        )}
        <span
          className={`text-sm font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          {title}
        </span>
      </div>
      <p
        className={`text-xs mt-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}
      >
        {t("settings.safetyQuestion", { question })}
      </p>
      {relation && (
        <p
          className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-500"}`}
        >
          {t("settings.safetyRelation", { relation })}
        </p>
      )}
    </div>
  );
}

export default SafetyPositionBanner;
