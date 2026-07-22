/**
 * ActionMenu — Phase 2 卡片级操作菜单（对标 Grok）
 *
 * 画廊中每张图片卡片右上角的 ⋯ 弹出菜单
 * 通过 store.setIntendedAction 与 BottomInputBar 通信
 * Phase 1 完善：删除功能接入后端 API，带确认对话框 + toast 反馈
 */

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMediaStore } from "../../../stores/mediaStore";
import { imageService } from "../../../services/imageService";
import { useToastStore } from "../../../stores/toastStore";

interface ActionMenuProps {
  itemId: string;
  itemUrl: string;
  itemType: "image" | "video";
  isDark: boolean;
}

/** 确认对话框 */
const ConfirmDialog: React.FC<{
  message: string;
  isDark: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ message, isDark, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div
      className={`rounded-lg p-4 shadow-xl ${
        isDark ? "bg-gray-700 text-gray-200" : "bg-white text-gray-700"
      }`}
      style={{ minWidth: 280 }}
    >
      <p className="mb-3 text-sm">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className={`rounded px-3 py-1 text-xs ${
            isDark
              ? "bg-gray-600 hover:bg-gray-500"
              : "bg-gray-100 hover:bg-gray-200"
          }`}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600"
        >
          删除
        </button>
      </div>
    </div>
  </div>
);

export const ActionMenu: React.FC<ActionMenuProps> = ({
  itemId,
  itemUrl,
  itemType,
  isDark,
}) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const setIntendedAction = useMediaStore((s) => s.setIntendedAction);
  const removeGalleryItem = useMediaStore((s) => s.removeGalleryItem);
  const addToast = useToastStore((s) => s.addToast);

  // 点击外部关闭（用 click 而非 mousedown，确保 onClick 先触发）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        (btnRef.current && btnRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    if (open) document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  // 打开时计算菜单位置
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      left: rect.right - 128, // 菜单宽度 128px，右对齐
      top: rect.bottom + 4,
      zIndex: 100,
    });
    setOpen(!open);
  };

  if (itemType !== "image") return null;

  /** 执行删除 */
  const handleDelete = async () => {
    setDeleting(true);
    setConfirming(false);
    setOpen(false);

    try {
      await imageService.deleteImage(itemUrl);
      removeGalleryItem(itemId);
      addToast("success", "图片已删除");
    } catch (err) {
      addToast("error", "删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  };

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
    } else if (type === "delete") {
      setConfirming(true);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        disabled={deleting}
        className={`absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors ${
          open
            ? "bg-gray-200 dark:bg-gray-600"
            : "bg-black/30 text-white opacity-0 group-hover:opacity-100"
        }`}
      >
        {deleting ? "⏳" : "⋯"}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`rounded-lg border py-1 shadow-lg ${
              isDark
                ? "border-gray-600 bg-gray-700 text-gray-200"
                : "border-gray-200 bg-white text-gray-700"
            }`}
            style={menuStyle}
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
          </div>,
          document.body,
        )}

      {/* 确认对话框 — 通过 Portal 渲染到 body，避免被卡片 contentVisibility:auto 的 contain:layout 裁剪 */}
      {confirming &&
        createPortal(
          <ConfirmDialog
            message="确定要删除此图片吗？此操作不可撤销。"
            isDark={isDark}
            onConfirm={handleDelete}
            onCancel={() => setConfirming(false)}
          />,
          document.body,
        )}
    </>
  );
};
