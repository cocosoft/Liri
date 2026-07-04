// canvas-editor/utils/i18n.ts — 国际化字符串定义

export interface CanvasEditorStrings {
  // 工具名
  tool_pencil: string; tool_eraser: string; tool_line: string; tool_arrow: string;
  tool_rect: string; tool_roundedRect: string; tool_ellipse: string; tool_polygon: string;
  tool_star: string; tool_fill: string; tool_text: string; tool_eyedropper: string;
  tool_select: string; tool_lasso: string; tool_pan: string;
  // 参数面板
  param_headSize: string; param_filled: string; param_radius: string;
  param_sides: string; param_points: string; param_innerRatio: string;
  param_transparent: string; param_strokeWidth: string;
  // 操作
  label_undo: string; label_redo: string; label_export: string; label_clear: string;
  label_resize: string; label_new: string; label_crop: string;
  label_flipH: string; label_flipV: string; label_recover: string;
  label_exportPng: string; label_exportJpeg: string; label_exportWebp: string;
  // 状态
  status_zoom: string; status_size: string;
  // 错误
  error_boundary: string; error_recover: string; error_load: string;
}

export const zh: CanvasEditorStrings = {
  tool_pencil: "画笔", tool_eraser: "橡皮", tool_line: "直线", tool_arrow: "箭头",
  tool_rect: "矩形", tool_roundedRect: "圆角矩形", tool_ellipse: "椭圆", tool_polygon: "多边形",
  tool_star: "星形", tool_fill: "填充", tool_text: "文字", tool_eyedropper: "取色",
  tool_select: "选区", tool_lasso: "套索", tool_pan: "平移",
  param_headSize: "箭头大小", param_filled: "实心", param_radius: "圆角半径",
  param_sides: "边数", param_points: "角数", param_innerRatio: "内径比",
  param_transparent: "透明擦", param_strokeWidth: "笔刷大小",
  label_undo: "撤销", label_redo: "重做", label_export: "导出", label_clear: "清空画布",
  label_resize: "调整大小", label_new: "新建画布", label_crop: "裁剪到选区",
  label_flipH: "水平翻转", label_flipV: "垂直翻转", label_recover: "恢复",
  label_exportPng: "导出 PNG", label_exportJpeg: "导出 JPEG", label_exportWebp: "导出 WebP",
  status_zoom: "缩放", status_size: "px",
  error_boundary: "画布编辑器遇到异常",
  error_recover: "尝试恢复",
  error_load: "图片加载失败",
};

export const en: CanvasEditorStrings = {
  tool_pencil: "Pencil", tool_eraser: "Eraser", tool_line: "Line", tool_arrow: "Arrow",
  tool_rect: "Rect", tool_roundedRect: "Rounded Rect", tool_ellipse: "Ellipse", tool_polygon: "Polygon",
  tool_star: "Star", tool_fill: "Fill", tool_text: "Text", tool_eyedropper: "Eyedropper",
  tool_select: "Select", tool_lasso: "Lasso", tool_pan: "Pan",
  param_headSize: "Head Size", param_filled: "Filled", param_radius: "Radius",
  param_sides: "Sides", param_points: "Points", param_innerRatio: "Inner Ratio",
  param_transparent: "Transparent", param_strokeWidth: "Brush Size",
  label_undo: "Undo", label_redo: "Redo", label_export: "Export", label_clear: "Clear Canvas",
  label_resize: "Resize", label_new: "New Canvas", label_crop: "Crop to Selection",
  label_flipH: "Flip Horizontal", label_flipV: "Flip Vertical", label_recover: "Recover",
  label_exportPng: "Export PNG", label_exportJpeg: "Export JPEG", label_exportWebp: "Export WebP",
  status_zoom: "Zoom", status_size: "px",
  error_boundary: "Canvas Editor encountered an error",
  error_recover: "Try Recover",
  error_load: "Image load failed",
};
