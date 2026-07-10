/**
 * ActionMenu — Phase 2 卡片级操作菜单（对标 Grok）
 *
 * 画廊中每张图片卡片右上角的 ⋯ 弹出菜单
 * 通过 store.setIntendedAction 与 BottomInputBar 通信
 */

import React, { useState, useRef, useEffect } from "react";
import { useMediaStore } from "../../../stores/mediaStore";

interface ActionMenuProps {
  itemId: string;
  itemUrl: string;
  itemType: "image" | "video";
  isDark: boolean;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({
  itemId,
  itemUrl,
  itemType,
  isDark,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setIntendedAction = useMediaStore((s) => s.setIntendedAction);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (itemType !== "image") return null;

  const handleAction = (
    type: "generate-video" | "edit-image" | "download" | "delete",
  ) => {
    setOpen(false);

    if (type === "generate-video" || type === "edit-image") {
      setIntendedAction({
        type,
        sourceImage: { id: itemId, url: itemUrl },
        autoSubmit: false,
      });
    } else if (type === "download") {
      window.open(itemUrl, "_blank");
    }
  };

  return (
    <div ref={ref} className="absolute right-1 top-1 z-10">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors ${
          open
            ? "bg-gray-200 dark:bg-gray-600"
            : "bg-black/30 text-white opacity-0 group-hover:opacity-100"
        }`}
      >
        ⋯
      </button>

      {open && (
        <div
          className={`absolute right-0 top-7 w-32 rounded-lg border py-1 shadow-lg ${
            isDark
              ? "border-gray-600 bg-gray-700 text-gray-200"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <button
            onClick={() => handleAction("generate-video")}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            🎬 生成视频
          </button>
          <button
            onClick={() => handleAction("edit-image")}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            ✏️ 编辑图片
          </button>
          <button
            onClick={() => handleAction("download")}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            ⬇️ 下载
          </button>
          <button
            onClick={() => handleAction("delete")}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            🗑️ 删除
          </button>
        </div>
      )}
    </div>
  );
};
