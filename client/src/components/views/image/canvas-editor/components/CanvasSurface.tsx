// canvas-editor/components/CanvasSurface.tsx — 三层 Canvas 绘制区
// 层级: Static(底部) → Interactive(预览) → Overlay(选区/文字)
// 事件统一在 Overlay 层监听，InputAdapter 坐标转换后分发

import React, { useRef, useEffect, useState } from "react";
import { CanvasTool, CanvasState } from "../types";
import { CanvasTransform } from "../core/CanvasTransform";
import { CommandManager } from "../core/CommandManager";
import { OffscreenBuffer } from "../core/OffscreenBuffer";
import { InputAdapter } from "../core/InputAdapter";
import { getTool } from "../tools/index";
import { ToolContext } from "../tools/base";
import { clipBoard } from "../utils/clipBoard";
import { SelectTool } from "../tools/SelectTool";
import { LassoSelectTool } from "../tools/LassoSelectTool";

interface Props {
  state: CanvasState;
  transform: CanvasTransform;
  buffer: OffscreenBuffer;
  commands: CommandManager;
  setActiveTool: (tool: CanvasTool) => void;
  onCursorMove: (x: number, y: number) => void;
  onStateChange: (s: Partial<CanvasState>) => void;
  onLoadImage?: (file: File | string) => void;
  /** 右键菜单导出回调 */
  onContextExport?: (format: "png" | "jpeg" | "webp") => void;
  /** 右键菜单清空回调 */
  onContextClear?: () => void;
  /** 右键菜单裁剪回调 */
  onContextCrop?: () => void;
  /** 右键菜单翻转回调 */
  onContextFlip?: (dir: "horizontal" | "vertical") => void;
  /** 右键菜单滤镜回调 */
  onContextFilter?: (op: "brightness+" | "brightness-" | "contrast+" | "contrast-" | "grayscale" | "invert" | "blur") => void;
  /** 右键菜单新建画布回调 */
  onContextNew?: () => void;
  /** Ctrl+S 快捷键导出回调 */
  onExportShortcut?: () => void;
  /** Ctrl+Shift+S 选区导出回调 */
  onSelectionExport?: () => void;
  /** 绘制状态通知（供自动保存互斥用） */
  onDrawingChange?: (drawing: boolean) => void;
}

let rafId = 0;
let needsRender = true;

/** 使用 Interactive 层进行实时预览的工具 */
const INTERACTIVE_TOOLS = new Set<CanvasTool>(["pencil", "eraser", "line", "arrow", "rect", "roundedRect", "ellipse", "polygon", "star"]);

/** 步进缩放档位（Ctrl+=/- 逐档切换） */
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 16.0];

/** 找到最接近的缩放档位索引 */
function findZoomStep(z: number) {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i] - z) < Math.abs(ZOOM_STEPS[best] - z)) best = i;
  }
  return best;
}

/** 从选区/套索工具获取当前选区 */
function getSelection(toolId: CanvasTool): { x: number; y: number; w: number; h: number } | null {
  if (toolId === "select") {
    const t = getTool("select") as SelectTool;
    return t?.getSelection?.() ?? null;
  }
  if (toolId === "lasso") {
    const t = getTool("lasso") as LassoSelectTool;
    return t?.getSelection?.() ?? null;
  }
  return null;
}

export const CanvasSurface: React.FC<Props> = ({ state, transform, buffer, commands, setActiveTool, onCursorMove, onStateChange, onLoadImage, onContextExport, onContextClear, onContextCrop, onContextFlip, onContextFilter, onContextNew, onExportShortcut, onSelectionExport, onDrawingChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const interactiveRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [toolCtx, setToolCtx] = useState<ToolContext | null>(null);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const closeContextMenu = () => setContextMenu(null);

  // 追踪最后光标位置（用于粘贴定位）
  const lastCursorRef = useRef({ x: 0, y: 0 });

  // 监听 canvas-render 自定义事件（由 CanvasEditor 工具栏按钮触发）
  useEffect(() => {
    const handler = () => { needsRender = true; };
    window.addEventListener("canvas-render", handler);
    return () => window.removeEventListener("canvas-render", handler);
  }, []);

  // 根据当前工具设置光标样式
  useEffect(() => {
    const overlayCanvas = overlayRef.current;
    if (!overlayCanvas) return;
    const tool = getTool(state.activeTool);
    overlayCanvas.style.cursor = tool?.cursor || "default";
  }, [state.activeTool]);

  // 长按取色器状态
  const toolBeforeEyedropper = useRef<CanvasTool | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPos = useRef({ x: 0, y: 0 });

  // 初始化 ToolContext（包含三层 Canvas 的 context 引用）
  useEffect(() => {
    const iCtx = interactiveRef.current?.getContext("2d") ?? null;
    const oCtx = overlayRef.current?.getContext("2d") ?? null;

    setToolCtx({
      buffer,
      transform,
      state,
      commands,
      setActiveTool,
      interactiveCtx: iCtx,
      overlayCtx: oCtx,
      overlayCanvas: overlayRef.current,
    });
  }, [buffer, transform, state, commands, setActiveTool]);

  // 渲染循环: Static 层从 Buffer drawImage（空闲 rAF，仅在 needsRender 时执行）
  const rafPending = useRef(false);
  useEffect(() => {
    const render = () => {
      rafPending.current = false;
      needsRender = false;

      const staticCanvas = staticRef.current;
      if (!staticCanvas) return;
      const sCtx = staticCanvas.getContext("2d");
      if (!sCtx) return;

      // Static 层：从 Buffer drawImage（应用 transform）
      sCtx.resetTransform();
      sCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
      transform.applyTransform(sCtx);
      sCtx.drawImage(buffer.getSource(), 0, 0);

      // 绘制画布背景边界指示（白色矩形边框）
      sCtx.strokeStyle = "rgba(255,255,255,0.15)";
      sCtx.lineWidth = 1;
      sCtx.strokeRect(0, 0, buffer.width, buffer.height);

      // Overlay 层：非选区工具时清理残留
      if (state.activeTool !== "select" && state.activeTool !== "lasso") {
        const overlayCanvas = overlayRef.current;
        if (overlayCanvas) {
          const oCtx = overlayCanvas.getContext("2d");
          if (oCtx) oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
      }

      // Interactive 层：非绘制工具时清理残留（绘制工具自行管理该层）
      if (!INTERACTIVE_TOOLS.has(state.activeTool)) {
        const iCanvas = interactiveRef.current;
        if (iCanvas) {
          const iCtx = iCanvas.getContext("2d");
          if (iCtx) iCtx.clearRect(0, 0, iCanvas.width, iCanvas.height);
        }
      }
    };

    // 渲染循环：首次渲染后持续轮询，每次 frame 检查 needsRender
    const scheduleLoop = () => {
      rafId = requestAnimationFrame(loop);
    };

    const loop = () => {
      if (needsRender && !rafPending.current) {
        rafPending.current = true;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          render();
          // 渲染完成后无条件恢复轮询，确保后续 canvas-render / ResizeObserver 信号能被拾取
          rafPending.current = needsRender;
          scheduleLoop();
        });
      } else {
        // needsRender 为 false 或已有 render 排队，继续下一帧轮询
        scheduleLoop();
      }
    };
    scheduleLoop();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };
  }, [transform, buffer, state.activeTool]);

  // ResizeObserver + 三层 Canvas 尺寸同步 + InputAdapter
  useEffect(() => {
    const container = containerRef.current;
    const staticCanvas = staticRef.current;
    const interactiveCanvas = interactiveRef.current;
    const overlayCanvas = overlayRef.current;
    if (!container || !staticCanvas || !interactiveCanvas || !overlayCanvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      transform.dpr = dpr;
      const w = container.clientWidth;
      const h = container.clientHeight;

      // 统一设置三层 Canvas 的尺寸
      for (const c of [staticCanvas, interactiveCanvas, overlayCanvas]) {
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = w + "px";
        c.style.height = h + "px";
      }

      // Interactive 层需要应用 transform
      const iCtx = interactiveCanvas.getContext("2d");
      if (iCtx) {
        iCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      if (state.fitToWindow) transform.fitTo(w, h, state.width, state.height);
      needsRender = true;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // InputAdapter —— 统一在 Overlay 层（顶层）监听事件
    const pointerDownRef = { current: false }; // 守卫：只有按下时 onPointerMove 才触发渲染
    const clearLongPress = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      if (toolBeforeEyedropper.current) {
        setActiveTool(toolBeforeEyedropper.current);
        toolBeforeEyedropper.current = null;
      }
    };

    const adapter = new InputAdapter(overlayCanvas, transform, {
      onPointerDown: (e) => {
        pointerDownRef.current = true;
        onDrawingChange?.(true);
        if (toolCtx) {
          // Alt+点击 → 临时取色器
          if (e.altKey) {
            const pixel = buffer.getImageData(Math.round(e.x), Math.round(e.y), 1, 1).data;
            const hex = "#" + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, "0")).join("");
            onStateChange({ fgColor: hex });
            return;
          }
          // 长按取色器（500ms 无移动 → 取色并恢复原工具）
          longPressPos.current = { x: e.x, y: e.y };
          longPressTimer.current = setTimeout(() => {
            toolBeforeEyedropper.current = state.activeTool as CanvasTool;
            const pixel = buffer.getImageData(Math.round(longPressPos.current.x), Math.round(longPressPos.current.y), 1, 1).data;
            const hex = "#" + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, "0")).join("");
            onStateChange({ fgColor: hex });
            longPressTimer.current = null;
          }, 500);

          const t = getTool(state.activeTool); t?.onPointerDown(e, toolCtx); needsRender = true;
        }
      },
      onPointerMove: (e) => {
        // 移动超过 5px 取消长按
        const dx = e.x - longPressPos.current.x;
        const dy = e.y - longPressPos.current.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        }
        lastCursorRef.current = { x: e.x, y: e.y };
        onCursorMove(e.x, e.y);
        if (toolCtx) { const t = getTool(state.activeTool); t?.onPointerMove(e, toolCtx); if (pointerDownRef.current) needsRender = true; }
      },
      onPointerUp: (e) => {
        pointerDownRef.current = false;
        onDrawingChange?.(false);
        clearLongPress();
        if (toolCtx) { const t = getTool(state.activeTool); t?.onPointerUp(e, toolCtx); needsRender = true; }
      },
    }, {
      // 双指捏合缩放
      onPinchZoom: (ratio, _cx, _cy) => {
        const z = Math.max(0.1, Math.min(8, transform.zoom * ratio));
        transform.setZoom(z);
        needsRender = true;
      },
      // 双指平移
      onTwoFingerPan: (dx, dy) => {
        transform.setOffset(transform.offsetX + dx, transform.offsetY + dy);
        needsRender = true;
      },
      // 双击 100%
      onDoubleTap: () => {
        transform.setZoom(1);
        needsRender = true;
      },
    });

    return () => { ro.disconnect(); adapter.destroy(); };
  }, [transform, buffer, state, toolCtx, onCursorMove]);

  // Canvas context 丢失/恢复保护
  useEffect(() => {
    const staticCanvas = staticRef.current;
    if (!staticCanvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault(); // 阻止默认行为，允许尝试恢复
    };

    const handleContextRestored = () => {
      // 从 OffscreenBuffer 全量恢复到主 Canvas
      needsRender = true;
    };

    staticCanvas.addEventListener("contextlost", handleContextLost);
    staticCanvas.addEventListener("contextrestored", handleContextRestored);
    return () => {
      staticCanvas.removeEventListener("contextlost", handleContextLost);
      staticCanvas.removeEventListener("contextrestored", handleContextRestored);
    };
  }, []);

  // 快捷键系统
  useEffect(() => {
    let spaceDown = false;
    let isComposing = false;

    const handleCompositionStart = () => { isComposing = true; };
    const handleCompositionEnd = () => { isComposing = false; };
    window.addEventListener("compositionstart", handleCompositionStart);
    window.addEventListener("compositionend", handleCompositionEnd);

    const handleKey = (e: KeyboardEvent) => {
      // IME 输入法模式下自动跳过全局快捷键
      if (isComposing) return;
      // 输入框内不触发快捷键
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.ctrlKey && e.key === "z") { e.preventDefault(); commands.undo(buffer.ctx); needsRender = true; }
      else if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); commands.redo(buffer.ctx); needsRender = true; }
      // Ctrl+S → 快速导出 PNG
      else if (e.ctrlKey && e.key === "s") { e.preventDefault(); onExportShortcut?.(); }
      // Ctrl+Shift+S → 选区导出
      else if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); onSelectionExport?.(); }
      // Ctrl+A → 全选画布
      else if (e.ctrlKey && e.key === "a") {
        e.preventDefault();
        setActiveTool("select");
        // 延迟一帧等待工具激活后执行全选
        requestAnimationFrame(() => {
          const selTool = getTool("select") as SelectTool;
          if (toolCtx) selTool?.selectAll?.(toolCtx);
        });
      }
      // Ctrl+C/V/X 剪切板（选区/套索工具激活时）
      else if (e.ctrlKey && e.key === "c" && (state.activeTool === "select" || state.activeTool === "lasso")) {
        e.preventDefault();
        const sel = getSelection(state.activeTool);
        if (sel) clipBoard.set(buffer.getImageData(sel.x, sel.y, sel.w, sel.h));
      }
      else if (e.ctrlKey && e.key === "x" && (state.activeTool === "select" || state.activeTool === "lasso")) {
        e.preventDefault();
        const sel = getSelection(state.activeTool);
        if (sel) {
          clipBoard.set(buffer.getImageData(sel.x, sel.y, sel.w, sel.h));
          const before = buffer.getImageData(0, 0, buffer.width, buffer.height);
          buffer.ctx.fillStyle = state.bgColor;
          buffer.ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
          const after = buffer.getImageData(0, 0, buffer.width, buffer.height);
          commands.execute({
            type: "selection",
            bbox: { x: 0, y: 0, w: buffer.width, h: buffer.height },
            before, after,
            apply: (c) => { c.putImageData(after, 0, 0); },
            revert: (c) => { c.putImageData(before, 0, 0); },
          });

          // 清除 overlay 选区框残留
          const oCanvas = overlayRef.current;
          if (oCanvas) {
            const oCtx = oCanvas.getContext("2d");
            if (oCtx) oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);
          }

          needsRender = true;
        }
      }
      else if (e.ctrlKey && e.key === "v" && clipBoard.has()) {
        e.preventDefault();
        const data = clipBoard.get()!;
        // 粘贴到光标位置（如果没有移动过光标则居中）
        const cursor = lastCursorRef.current;
        const px = Math.max(0, Math.min(buffer.width - data.width, Math.round(cursor.x - data.width / 2)));
        const py = Math.max(0, Math.min(buffer.height - data.height, Math.round(cursor.y - data.height / 2)));
        const before = buffer.getImageData(px, py, data.width, data.height);
        buffer.ctx.putImageData(data, px, py);
        const after = buffer.getImageData(px, py, data.width, data.height);
        commands.execute({
          type: "selection",
          bbox: { x: px, y: py, w: data.width, h: data.height },
          before, after,
          apply: (c) => { c.putImageData(after, px, py); },
          revert: (c) => { c.putImageData(before, px, py); },
        });
        needsRender = true;
      }
      else if (e.key === "b" || e.key === "p") setActiveTool("pencil");
      else if (e.key === "e") setActiveTool("eraser");
      else if (e.key === "l") setActiveTool("line");
      else if (e.key === "a") setActiveTool("arrow");
      else if (e.key === "r") setActiveTool("rect");
      else if (e.key === "u") setActiveTool("roundedRect");
      else if (e.key === "o") setActiveTool("ellipse");
      else if (e.key === "y") setActiveTool("polygon");
      else if (e.key === "s") setActiveTool("star");
      else if (e.key === "g") setActiveTool("fill");
      else if (e.key === "t") setActiveTool("text");
      else if (e.key === "i") setActiveTool("eyedropper");
      else if (e.key === "h") setActiveTool("pan");
      else if (e.key === "v") setActiveTool("select");
      else if (e.key === "m") setActiveTool("lasso");
      else if (e.key === " ") { spaceDown = true; e.preventDefault(); }
      // Escape → 取消选区 / 切换回画笔
      else if (e.key === "Escape") {
        if (state.activeTool === "select" || state.activeTool === "lasso") setActiveTool("pencil");
      }
      // 方向键 → 微调选区（1px / Shift+10px）
      else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        && (state.activeTool === "select" || state.activeTool === "lasso")) {
        const sel = getSelection(state.activeTool);
        if (sel && sel.w > 0 && sel.h > 0) {
          const step = e.shiftKey ? 10 : 1;
          let dx = 0, dy = 0;
          if (e.key === "ArrowLeft") dx = -step;
          if (e.key === "ArrowRight") dx = step;
          if (e.key === "ArrowUp") dy = -step;
          if (e.key === "ArrowDown") dy = step;

          const nx = Math.max(0, Math.min(buffer.width - sel.w, sel.x + dx));
          const ny = Math.max(0, Math.min(buffer.height - sel.h, sel.y + dy));
          if (nx === sel.x && ny === sel.y) return; // 无移动

          const selectedPixels = buffer.getImageData(sel.x, sel.y, sel.w, sel.h);
          const before = buffer.getImageData(0, 0, buffer.width, buffer.height);
          buffer.ctx.fillStyle = state.bgColor;
          buffer.ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
          buffer.ctx.putImageData(selectedPixels, nx, ny);
          const after = buffer.getImageData(0, 0, buffer.width, buffer.height);

          commands.execute({
            type: "selection",
            bbox: { x: 0, y: 0, w: buffer.width, h: buffer.height },
            before, after,
            apply: (c) => { c.putImageData(after, 0, 0); },
            revert: (c) => { c.putImageData(before, 0, 0); },
          });
          // 清除 overlay 旧位置选区框
          const oCanvas = overlayRef.current;
          if (oCanvas) {
            const oCtx = oCanvas.getContext("2d");
            if (oCtx) oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);
          }
          needsRender = true;
        }
        e.preventDefault();
      }
      // Delete → 仅清除选区内容
      else if (e.key === "Delete" && (state.activeTool === "select" || state.activeTool === "lasso")) {
        const sel = getSelection(state.activeTool);
        if (sel && sel.w > 0 && sel.h > 0) {
          const before = buffer.getImageData(sel.x, sel.y, sel.w, sel.h);
          buffer.ctx.fillStyle = state.bgColor;
          buffer.ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
          const after = buffer.getImageData(sel.x, sel.y, sel.w, sel.h);
          commands.execute({
            type: "selection",
            bbox: { x: sel.x, y: sel.y, w: sel.w, h: sel.h },
            before, after,
            apply: (c) => { c.putImageData(after, sel.x, sel.y); },
            revert: (c) => { c.putImageData(before, sel.x, sel.y); },
          });

          // 清除 overlay 选区框残留
          const oCanvas = overlayRef.current;
          if (oCanvas) {
            const oCtx = oCanvas.getContext("2d");
            if (oCtx) oCtx.clearRect(0, 0, oCanvas.width, oCanvas.height);
          }

          needsRender = true;
        }
      }
      else if (e.key === "[") onStateChange({ strokeWidth: Math.max(1, state.strokeWidth - 1) });
      else if (e.key === "]") onStateChange({ strokeWidth: Math.min(20, state.strokeWidth + 1) });
      // Ctrl+= / Ctrl+- 步进缩放（ZOOM_STEPS 11 档）
      else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const idx = findZoomStep(transform.zoom);
        transform.setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx + 1)]);
        needsRender = true;
      }
      else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        const idx = findZoomStep(transform.zoom);
        transform.setZoom(ZOOM_STEPS[Math.max(0, idx - 1)]);
        needsRender = true;
      }
      else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        transform.setZoom(1);
        needsRender = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === " ") spaceDown = false; };

    // 滚轮缩放 + Space 平移
    const handleWheel = (e: WheelEvent) => {
      if (spaceDown) {
        transform.setOffset(transform.offsetX - e.deltaX, transform.offsetY - e.deltaY);
        needsRender = true;
      } else {
        const z = transform.zoom * (e.deltaY > 0 ? 0.9 : 1.1);
        transform.setZoom(z);
        needsRender = true;
      }
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKeyUp);
    const container = containerRef.current;
    if (container) container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("compositionstart", handleCompositionStart);
      window.removeEventListener("compositionend", handleCompositionEnd);
      if (container) container.removeEventListener("wheel", handleWheel);
    };
  }, [commands, buffer, state.strokeWidth, setActiveTool, onStateChange, transform]);

  // 拖拽导入图片
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onLoadImage) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) {
        onLoadImage(file);
      }
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [onLoadImage]);

  // 右键上下文菜单
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };

    // 点击外部关闭菜单
    const handleClick = () => { if (contextMenu) closeContextMenu(); };

    container.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClick);
    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClick);
    };
  }, [contextMenu]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-950"
        style={{
          backgroundImage: "linear-gradient(45deg, #1a1a2e 25%, transparent 25%), linear-gradient(-45deg, #1a1a2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a2e 75%), linear-gradient(-45deg, transparent 75%, #1a1a2e 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
        }}
      >
      {/* Static 层 — 从 Buffer 渲染（底部） */}
      <canvas ref={staticRef} className="absolute inset-0 z-0" />

      {/* Interactive 层 — 形状预览（中间，应用 transform） */}
      <canvas ref={interactiveRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* Overlay 层 — 选区框/文字编辑框（顶部，像素对齐，接收事件） */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 z-20"
        tabIndex={0}
        role="img"
        aria-label="画布编辑器"
      />

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] py-1 bg-gray-800 border border-gray-600/40 rounded shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { commands.undo(buffer.ctx); needsRender = true; closeContextMenu(); }}
            disabled={!commands.canUndo()}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-30 border-0 bg-transparent cursor-pointer"
          >撤销 (Ctrl+Z)</button>
          <button
            onClick={() => { commands.redo(buffer.ctx); needsRender = true; closeContextMenu(); }}
            disabled={!commands.canRedo()}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-30 border-0 bg-transparent cursor-pointer"
          >重做 (Ctrl+Y)</button>
          <div className="h-px bg-gray-600/30 my-1" />
          <button onClick={() => { onContextExport?.("png"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">导出 PNG</button>
          <button onClick={() => { onContextExport?.("jpeg"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">导出 JPEG</button>
          <div className="h-px bg-gray-600/30 my-1" />
          <button onClick={() => { onContextFlip?.("horizontal"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">水平翻转</button>
          <button onClick={() => { onContextFlip?.("vertical"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">垂直翻转</button>
          <div className="h-px bg-gray-600/30 my-1" />
          {/* 滤镜 */}
          <button onClick={() => { onContextFilter?.("brightness+"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">亮度 +</button>
          <button onClick={() => { onContextFilter?.("brightness-"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">亮度 -</button>
          <button onClick={() => { onContextFilter?.("contrast+"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">对比度 +</button>
          <button onClick={() => { onContextFilter?.("contrast-"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">对比度 -</button>
          <button onClick={() => { onContextFilter?.("grayscale"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">灰度</button>
          <button onClick={() => { onContextFilter?.("invert"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">反相</button>
          <button onClick={() => { onContextFilter?.("blur"); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">模糊</button>
          <div className="h-px bg-gray-600/30 my-1" />
          <button onClick={() => { onContextCrop?.(); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">裁剪到选区</button>
          <button onClick={() => { onContextNew?.(); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">新建画布</button>
          <button onClick={() => { onContextClear?.(); closeContextMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 border-0 bg-transparent cursor-pointer">清空画布</button>
        </div>
      )}
    </div>
  );
};
