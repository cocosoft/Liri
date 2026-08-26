/**
 * BottomInputBar — Phase 2 底部统一输入栏（对标 Grok）
 *
 * segmented control: 图片 | 视频
 * 提示词输入 + 动态参数（时长/数量/宽高比）+ 生成按钮
 */

import React, { useEffect, useState } from "react";
import { useMediaStore } from "../../../stores/mediaStore";

/**
 * 长宽比选项（含面向小白用户的语义标签）
 * 2026-08-26：示意图帮助理解 16:9（横）与 9:16（竖）的区别
 */
const RATIO_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "16:9", label: "16:9", hint: "横屏" },
  { value: "9:16", label: "9:16", hint: "竖屏" },
  { value: "1:1", label: "1:1", hint: "方形" },
  { value: "2:3", label: "2:3", hint: "竖版" },
  { value: "3:2", label: "3:2", hint: "横版" },
];

/** 按真实宽高比渲染的迷你矩形示意图 */
const RatioGlyph: React.FC<{ ratio: string }> = ({ ratio }) => {
  const [w, h] = ratio.split(":").map(Number);
  const H = 14;
  const width = H * (w / h);
  return (
    <span
      className="inline-block shrink-0 rounded-sm border border-current"
      style={{ width, height: H, opacity: 0.85 }}
      aria-hidden
    />
  );
};

/** 长宽比下拉（示意图 + 标签 + 语义提示 + 自定义尺寸） */
const AspectRatioSelect: React.FC<{
  value: string;
  isDark: boolean;
  onChange: (v: string) => void;
}> = ({ value, isDark, onChange }) => {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customW, setCustomW] = useState("16");
  const [customH, setCustomH] = useState("9");

  // 当前值是否来自预设列表（否则视为自定义比例）
  const isCustom = !RATIO_OPTIONS.some((o) => o.value === value);
  const current = RATIO_OPTIONS.find((o) => o.value === value);

  const openCustom = () => {
    const [w = "16", h = "9"] = value.split(":");
    setCustomW(w);
    setCustomH(h);
    setCustomMode(true);
  };

  const applyCustom = () => {
    const w = Math.max(1, Math.min(100, parseInt(customW, 10) || 1));
    const h = Math.max(1, Math.min(100, parseInt(customH, 10) || 1));
    onChange(`${w}:${h}`);
    setCustomMode(false);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="选择图片/视频长宽比"
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
          isDark
            ? "border-gray-600 bg-gray-700 text-gray-200"
            : "border-gray-200 bg-gray-100 text-gray-600"
        }`}
      >
        <RatioGlyph ratio={value} />
        <span>{current ? current.label : "自定义"}</span>
        <span className="text-[10px] text-gray-400">
          {current ? current.hint : value}
        </span>
        <span className="text-[8px] opacity-60">▼</span>
      </button>

      {open && (
        <>
          {/* 点击空白关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute bottom-full left-0 z-20 mb-1 w-36 rounded-lg border p-1 shadow-lg ${
              isDark
                ? "border-gray-600 bg-gray-800"
                : "border-gray-200 bg-white"
            }`}
          >
            {RATIO_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setCustomMode(false);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  opt.value === value
                    ? "text-blue-600 dark:text-blue-400"
                    : isDark
                      ? "text-gray-200"
                      : "text-gray-600"
                }`}
              >
                <RatioGlyph ratio={opt.value} />
                <span>{opt.label}</span>
                <span className="text-[10px] text-gray-400">{opt.hint}</span>
              </button>
            ))}

            {/* 自定义尺寸 */}
            <div className="my-1 border-t border-gray-200 dark:border-gray-600" />
            {customMode ? (
              <div className="flex items-center gap-1 px-1 py-1">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  className={`w-10 rounded border px-1 py-0.5 text-center text-xs ${
                    isDark
                      ? "border-gray-600 bg-gray-700 text-gray-200"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                />
                <span className="text-xs text-gray-400">:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  className={`w-10 rounded border px-1 py-0.5 text-center text-xs ${
                    isDark
                      ? "border-gray-600 bg-gray-700 text-gray-200"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                />
                <button
                  type="button"
                  onClick={applyCustom}
                  className="ml-auto rounded bg-blue-500 px-2 py-0.5 text-xs text-white hover:bg-blue-600"
                >
                  应用
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openCustom}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  isCustom
                    ? "text-blue-600 dark:text-blue-400"
                    : isDark
                      ? "text-gray-200"
                      : "text-gray-600"
                }`}
              >
                <span className="inline-block h-3.5 w-4 shrink-0 rounded-sm border border-dashed border-current opacity-85" />
                <span>自定义</span>
                {isCustom && (
                  <span className="text-[10px] text-gray-400">{value}</span>
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

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
        useMediaStore
          .getState()
          .setSelectedImage(
            intendedAction.sourceImage.url,
            intendedAction.sourceImage.id,
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
    <div className="px-3 py-2 bg-transparent">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-lg p-3">
          {/* 模式切换 + 选中图片 */}
          <div className="mb-2 flex items-center gap-3">
            <ModeSegmentedControl />

            {selectedImageUrl && (
              <div className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 dark:bg-blue-900/20">
                <span className="truncate text-xs text-blue-600 dark:text-blue-400 max-w-[150px]">
                  已选图片
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
              className={`w-full resize-none rounded-xl border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                isDark
                  ? "border-gray-600 bg-gray-700 text-gray-200 placeholder-gray-500"
                  : "border-gray-200 bg-gray-50 text-gray-700 placeholder-gray-400"
              }`}
            />
          </div>

          {/* 动态参数 + 生成按钮 */}
          <div className="flex items-center gap-2">
            {isVideoMode ? (
              <select
                value={params.duration || 5}
                onChange={(e) =>
                  setParams({ duration: Number(e.target.value) })
                }
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  isDark
                    ? "border-gray-600 bg-gray-700 text-gray-200"
                    : "border-gray-200 bg-gray-100 text-gray-600"
                }`}
              >
                <option value={5}>5 秒</option>
                <option value={8}>8 秒</option>
                <option value={10}>10 秒</option>
              </select>
            ) : (
              <select
                value={params.count || 1}
                onChange={(e) => setParams({ count: Number(e.target.value) })}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  isDark
                    ? "border-gray-600 bg-gray-700 text-gray-200"
                    : "border-gray-200 bg-gray-100 text-gray-600"
                }`}
              >
                <option value={1}>1 张</option>
                <option value={2}>2 张</option>
                <option value={4}>4 张</option>
              </select>
            )}

            {/* 2026-08-26：长宽比选择器带按比例示意图，帮助区分横屏/竖屏 */}
            <AspectRatioSelect
              value={params.aspectRatio || "16:9"}
              isDark={isDark}
              onChange={(v) => setParams({ aspectRatio: v })}
            />

            <button
              onClick={onGenerate}
              disabled={(!prompt.trim() && !selectedImageUrl) || generating}
              className="ml-auto rounded-full bg-blue-600 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {generating ? "生成中…" : "生成"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
