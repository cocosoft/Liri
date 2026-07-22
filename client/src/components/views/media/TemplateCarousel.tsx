/**
 * TemplateCarousel + TemplateCard — Phase 2 模板预设轮播（对标 Grok）
 *
 * 顶部横向滚动的 I2I/I2I2V 模板卡片
 * 从 GET /v1/media/templates 加载模板数据
 */

import React, { useEffect, useState } from "react";
import { useMediaStore } from "../../../stores/mediaStore";

/** 模板数据（与后端 MediaTemplateRecord 对应） */
interface TemplateInfo {
  id: string;
  name: string;
  type: "i2i" | "i2i2v";
  category: string;
  thumbnailUrl: string | null;
  promptTemplate: string | null;
  requiresImage: boolean;
  sortOrder: number;
}

export const TemplateCarousel: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const selectedId = useMediaStore((s) => s.selectedId);
  const selectTemplate = useMediaStore((s) => s.selectTemplate);
  const setIntendedAction = useMediaStore((s) => s.setIntendedAction);

  // 加载模板数据
  useEffect(() => {
    fetch("/v1/media/templates")
      .then((r) => r.json())
      .then((data) => {
        if (data.templates) setTemplates(data.templates);
      })
      .catch(() => {});
  }, []);

  if (templates.length === 0) return null;

  const handleClick = (tmpl: TemplateInfo) => {
    selectTemplate(tmpl.id);

    // 通过信令触发 BottomInputBar
    if (selectedId) {
      const item = useMediaStore.getState().getSelectedItem();
      setIntendedAction({
        type: tmpl.type === "i2i2v" ? "generate-video" : "edit-image",
        sourceImage: item ? { id: item.id, url: item.url } : null,
        autoSubmit: false,
      });
    }

    // 填入模板 prompt 到输入框
    if (tmpl.promptTemplate) {
      useMediaStore.getState().setPrompt(tmpl.promptTemplate);
    }
  };

  return (
    <div className="overflow-x-auto border-b border-gray-200 px-3 py-2 dark:border-gray-700">
      <div className="flex gap-2">
        {templates.map((tmpl) => (
          <button
            key={tmpl.id}
            onClick={() => handleClick(tmpl)}
            className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              isDark
                ? "border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            title={
              tmpl.promptTemplate ||
              `${tmpl.name} (${tmpl.type === "i2i2v" ? "图生视频" : "图生图"})`
            }
          >
            <span className="mr-1">{tmpl.type === "i2i2v" ? "🎬" : "🖼️"}</span>
            {tmpl.name}
          </button>
        ))}
      </div>
    </div>
  );
};
