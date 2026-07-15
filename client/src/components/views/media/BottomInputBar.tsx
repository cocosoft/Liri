/**
 * BottomInputBar — Phase 2 底部统一输入栏（对标 Grok）
 *
 * segmented control: 图片 | 视频
 * 提示词输入 + 动态参数（时长/数量/宽高比）+ 生成按钮
 */

import React, { useEffect } from "react";
import { useMediaStore } from "../../../stores/mediaStore";

/**
 * 图片|视频 模式切换
 */
const ModeSegmentedControl: React.FC = () => {
  const mode = useMediaStore((s) => s.mode);
  const setMode = useMediaStore((s) => s.setMode);

  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5 dark:border-gray-600 dark:bg-gray-700">
      <button
        onClick={() => setMode("image")}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          mode === "image"
            ? "bg-white text-blue-600 shadow-sm dark:bg-gray-600 dark:text-blue-400"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        }`}
      >
        图片
      </button>
      <button
        onClick={() => setMode("video")}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          mode === "video"
            ? "bg-white text-blue-600 shadow-sm dark:bg-gray-600 dark:text-blue-400"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        }`}
      >
        视频
      </button>
    </div>
  );
};

export const BottomInputBar: React.FC<{
  isDark: boolean;
  generating: boolean;
  onGenerate: () => void;
}> = ({ isDark, generating, onGenerate }) => {
  const mode = useMediaStore((s) => s.mode);
  const setMode = useMediaStore((s) => s.setMode);
  const prompt = useMediaStore((s) => s.prompt);
  const setPrompt = useMediaStore((s) => s.setPrompt);
  const selectedImageUrl = useMediaStore((s) => s.selectedImageUrl);
  const clearSelectedImage = useMediaStore((s) => s.clearSelectedImage);
  const params = useMediaStore((s) => s.params);
  const setParams = useMediaStore((s) => s.setParams);
  const intendedAction = useMediaStore((s) => s.intendedAction);
  const clearIntendedAction = useMediaStore((s) => s.clearIntendedAction);

  // 订阅跨组件信令（ActionMenu / TemplateCarousel 触发）
  useEffect(() => {
    if (!intendedAction) return;

    // 防止重复消费
    const store = useMediaStore.getState();
    if (intendedAction.seq <= store.lastConsumedSeq) return;

    // 消费意图
    if (intendedAction.type === "generate-video") {
      setMode("video");
      if (intendedAction.sourceImage) {
        useMediaStore.getState().setSelectedImage(
          intendedAction.sourceImage.url,
          intendedAction.sourceImage.id
        );
      }
      useMediaStore.getState().lastConsumedSeq = intendedAction.seq;

      if (intendedAction.autoSubmit) {
        // 自动触发：填入模板 prompt 后立即生成
        setTimeout(() => onGenerate(), 100);
      }
    } else if (intendedAction.type === "edit-image") {
      // 编辑图片：设置 editingImage + 提前 return，不切模式
      if (intendedAction.sourceImage) {
        useMediaStore.getState().setEditingImage(intendedAction.sourceImage);
      }
      useMediaStore.getState().lastConsumedSeq = intendedAction.seq;
      clearIntendedAction();
      return; // 提前 return，不执行下面的 setMode("image")
    }

    clearIntendedAction();
  }, [intendedAction, setMode, clearIntendedAction, onGenerate]);

  const isVideoMode = mode === "video";

  return (
    <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      {/* 模式切换 + 选中图片 */}
      <div className="mb-2 flex items-center gap-3">
        <ModeSegmentedControl />

        {selectedImageUrl && (
          <div className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 dark:bg-blue-900/20">
            <span className="truncate text-xs text-blue-600 dark:text-blue-400 max-w-[150px]">
              🖼️ 已选图片
            </span>
            <button
              onClick={clearSelectedImage}
              className="text-xs text-blue-400 hover:text-blue-600"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* 提示词输入 */}
      <div className="mb-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isVideoMode
              ? "描述你想生成的视频内容..."
              : "描述你想生成的图片内容..."
          }
          rows={2}
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
            isDark
              ? "border-gray-600 bg-gray-700 text-gray-200 placeholder-gray-500"
              : "border-gray-300 bg-gray-50 text-gray-700 placeholder-gray-400"
          }`}
        />
      </div>

      {/* 动态参数 + 生成按钮 */}
      <div className="flex items-center gap-3">
        {isVideoMode ? (
          <>
            <select
              value={params.duration || 5}
              onChange={(e) =>
                setParams({ duration: Number(e.target.value) })
              }
              className={`rounded-md border px-2 py-1.5 text-xs ${
                isDark
                  ? "border-gray-600 bg-gray-700 text-gray-200"
                  : "border-gray-300 bg-white text-gray-700"
              }`}
            >
              <option value={5}>5 秒</option>
              <option value={8}>8 秒</option>
              <option value={10}>10 秒</option>
            </select>
          </>
        ) : (
          <select
            value={params.count || 1}
            onChange={(e) => setParams({ count: Number(e.target.value) })}
            className={`rounded-md border px-2 py-1.5 text-xs ${
              isDark
                ? "border-gray-600 bg-gray-700 text-gray-200"
                : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            <option value={1}>1 张</option>
            <option value={2}>2 张</option>
            <option value={4}>4 张</option>
          </select>
        )}

        <select
          value={params.aspectRatio || "16:9"}
          onChange={(e) => setParams({ aspectRatio: e.target.value })}
          className={`rounded-md border px-2 py-1.5 text-xs ${
            isDark
              ? "border-gray-600 bg-gray-700 text-gray-200"
              : "border-gray-300 bg-white text-gray-700"
          }`}
        >
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="2:3">2:3</option>
          <option value="3:2">3:2</option>
        </select>

        <button
          onClick={onGenerate}
          disabled={(!prompt.trim() && !selectedImageUrl) || generating}
          className="ml-auto rounded-lg bg-blue-600 px-6 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {generating ? "生成中…" : "生成"}
        </button>
      </div>
    </div>
  );
};
