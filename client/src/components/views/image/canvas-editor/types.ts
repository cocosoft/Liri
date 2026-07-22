// canvas-editor/types.ts — 核心类型定义

export type CanvasTool =
  | "pencil"
  | "eraser"
  | "line"
  | "arrow"
  | "rect"
  | "roundedRect"
  | "ellipse"
  | "polygon"
  | "star"
  | "fill"
  | "text"
  | "eyedropper"
  | "select"
  | "lasso"
  | "pan";

export interface CanvasPointerEvent {
  x: number;
  y: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pressure: number;
}

export interface ParamSchema {
  name: string;
  type: "string" | "number" | "boolean";
  default?: unknown;
  labelKey: string;
}

export interface DrawCommand {
  type:
    | "stroke"
    | "shape"
    | "fill"
    | "text"
    | "clear"
    | "image"
    | "selection"
    | "paramChange";
  bbox: { x: number; y: number; w: number; h: number };
  before: ImageData;
  after: ImageData;
  apply(ctx: OffscreenCanvasRenderingContext2D): void;
  revert(ctx: OffscreenCanvasRenderingContext2D): void;
}

export interface CanvasState {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  fitToWindow: boolean;
  activeTool: CanvasTool;
  strokeWidth: number;
  fgColor: string;
  bgColor: string;
  /** 当前工具的动态参数（由 paramsSchema 驱动） */
  toolParams: Record<string, unknown>;
}

/** 图层接口（P2 扩展预留 — 图层面板只需 Layer[] 数组） */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-1
  composite: GlobalCompositeOperation;
  /** 该层的 1:1 像素缓冲 */
  buffer: OffscreenCanvas;
  /** 缩略图（80×60 预览用） */
  thumbnail?: ImageData;
}

/** 剪贴板区域抽象 */
export interface ClipRegion {
  /** 选区多边形顶点（逻辑坐标） */
  polygon?: { x: number; y: number }[];
  /** 或矩形选区 */
  rect?: { x: number; y: number; w: number; h: number };
}

/** CanvasEditor 组件 Props */
export interface CanvasEditorProps {
  width?: number;
  height?: number;
  /** 初始背景色 */
  bgColor?: string;
  /** 初始加载的图片 URL */
  src?: string;
  /** 画布唯一 ID（用于多画布草稿箱隔离） */
  canvasId?: string;
  /** 容器高度 CSS 类（Modal 模式："h-full max-h-[calc(100vh-4rem)]"；默认兼容 ImagePage） */
  containerHeight?: string;
  /** 保存回调（Modal 模式传入，传入后原有导出按钮隐藏） */
  onSave?: (blob: Blob | null) => Promise<void>;
  /** 取消回调（Modal 模式传入） */
  onCancel?: () => void;
  /** 脏状态变更回调（告知外部是否有未保存更改） */
  onDirty?: (dirty: boolean) => void;
}
