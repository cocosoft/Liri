// canvas-editor/tools/ShapeTool.ts — 全部形状工具（Interactive 层 rAF 预览）
// 支持: line / rect / ellipse / arrow / roundedRect / polygon / star
// 工具参数通过 paramsSchema 自描述，绘制时从 ctx.state.toolParams 读取

import { CanvasTool, CanvasPointerEvent, ParamSchema } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

type ShapeKind =
  "line" | "rect" | "ellipse" | "arrow" | "roundedRect" | "polygon" | "star";

/** 各形状的默认参数 schema */
const FILL_PARAM: ParamSchema = {
  name: "filled",
  type: "boolean",
  default: false,
  labelKey: "实心",
};

const SHAPE_PARAMS: Record<ShapeKind, ParamSchema[]> = {
  line: [],
  rect: [FILL_PARAM],
  ellipse: [FILL_PARAM],
  arrow: [
    { name: "headSize", type: "number", default: 10, labelKey: "箭头大小" },
  ],
  roundedRect: [
    FILL_PARAM,
    { name: "radius", type: "number", default: 12, labelKey: "圆角半径" },
  ],
  polygon: [
    { name: "sides", type: "number", default: 5, labelKey: "边数" },
    FILL_PARAM,
  ],
  star: [
    { name: "points", type: "number", default: 5, labelKey: "角数" },
    { name: "innerRatio", type: "number", default: 0.4, labelKey: "内径比" },
    FILL_PARAM,
  ],
};

/** 从 toolParams 获取数值参数 */
function getParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/** 绘制箭头头部 */
function drawArrowHead(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headSize: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headSize * Math.cos(angle - Math.PI / 6),
    y2 - headSize * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headSize * Math.cos(angle + Math.PI / 6),
    y2 - headSize * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/** 绘制圆角矩形路径 */
function roundedRectPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 绘制正多边形路径（不 stroke） */
function polygonPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 绘制星形路径（不 stroke） */
function starPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  points: number,
  innerRatio: number,
) {
  const innerR = outerR * innerRatio;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 在指定 ctx 上绘制形状（参数从 toolParams 读取） */
function drawShape(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  kind: ShapeKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fgColor: string,
  strokeWidth: number,
  toolParams: Record<string, unknown>,
) {
  ctx.strokeStyle = fgColor;
  ctx.fillStyle = fgColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const filled = !!toolParams.filled;
  const cx = (x1 + x2) / 2,
    cy = (y1 + y2) / 2;
  const r = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2;

  switch (kind) {
    case "line":
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;

    case "arrow": {
      const headSize = getParam(toolParams, "headSize", 10);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      drawArrowHead(ctx, x1, y1, x2, y2, headSize);
      break;
    }

    case "rect":
      ctx.beginPath();
      ctx.rect(
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.abs(x2 - x1),
        Math.abs(y2 - y1),
      );
      if (filled) ctx.fill();
      ctx.stroke();
      break;

    case "roundedRect": {
      const rx = Math.min(x1, x2),
        ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1),
        rh = Math.abs(y2 - y1);
      const radius = getParam(toolParams, "radius", 12);
      ctx.beginPath();
      roundedRectPath(ctx, rx, ry, rw, rh, Math.min(radius, rw / 2, rh / 2));
      if (filled) ctx.fill();
      ctx.stroke();
      break;
    }

    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        Math.abs(x2 - x1) / 2,
        Math.abs(y2 - y1) / 2,
        0,
        0,
        Math.PI * 2,
      );
      if (filled) ctx.fill();
      ctx.stroke();
      break;

    case "polygon": {
      const sides = getParam(toolParams, "sides", 5);
      polygonPath(ctx, cx, cy, r, sides);
      if (filled) ctx.fill();
      ctx.stroke();
      break;
    }

    case "star": {
      const points = getParam(toolParams, "points", 5);
      const innerRatio = getParam(toolParams, "innerRatio", 0.4);
      starPath(ctx, cx, cy, r, points, innerRatio);
      if (filled) ctx.fill();
      ctx.stroke();
      break;
    }
  }
}

/** 计算形状包围盒 */
function calcBbox(
  _kind: ShapeKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sw: number,
) {
  return {
    bx: Math.floor(Math.min(x1, x2) - sw * 3),
    by: Math.floor(Math.min(y1, y2) - sw * 3),
    bw: Math.ceil(Math.abs(x2 - x1) + sw * 6),
    bh: Math.ceil(Math.abs(y2 - y1) + sw * 6),
  };
}

export function createShapeTool(
  kind: ShapeKind,
  id: CanvasTool,
): CanvasToolHandler {
  let startX = 0,
    startY = 0;
  let isDrawing = false;

  const paramsSchema = SHAPE_PARAMS[kind];

  return {
    id,
    cursor: "crosshair",
    paramsSchema,

    onPointerDown(e: CanvasPointerEvent, _ctx: ToolContext) {
      startX = e.x;
      startY = e.y;
      isDrawing = true;
    },

    onPointerMove(e: CanvasPointerEvent, ctx: ToolContext) {
      if (!isDrawing) return;
      const ic = ctx.interactiveCtx;
      if (ic) {
        ic.setTransform(1, 0, 0, 1, 0, 0);
        ic.clearRect(0, 0, ic.canvas.width, ic.canvas.height);
        ctx.transform.applyTransform(ic);
        drawShape(
          ic,
          kind,
          startX,
          startY,
          e.x,
          e.y,
          ctx.state.fgColor,
          ctx.state.strokeWidth,
          ctx.state.toolParams,
        );
      }
    },

    onPointerUp(e: CanvasPointerEvent, ctx: ToolContext) {
      if (!isDrawing) return;
      isDrawing = false;

      const x1 = startX,
        y1 = startY,
        x2 = e.x,
        y2 = e.y;
      const { bx, by, bw, bh } = calcBbox(
        kind,
        x1,
        y1,
        x2,
        y2,
        ctx.state.strokeWidth,
      );

      const ic = ctx.interactiveCtx;
      if (ic) {
        ic.setTransform(1, 0, 0, 1, 0, 0);
        ic.clearRect(0, 0, ic.canvas.width, ic.canvas.height);
      }

      const before = ctx.buffer.getImageData(
        Math.max(0, bx),
        Math.max(0, by),
        bw,
        bh,
      );
      drawShape(
        ctx.buffer.ctx,
        kind,
        x1,
        y1,
        x2,
        y2,
        ctx.state.fgColor,
        ctx.state.strokeWidth,
        ctx.state.toolParams,
      );
      const after = ctx.buffer.getImageData(
        Math.max(0, bx),
        Math.max(0, by),
        bw,
        bh,
      );

      ctx.commands.execute({
        type: "shape",
        bbox: { x: bx, y: by, w: bw, h: bh },
        before,
        after,
        apply: (c) => {
          c.putImageData(after, bx, by);
        },
        revert: (c) => {
          c.putImageData(before, bx, by);
        },
      });
      startX = 0;
    },

    onDeactivate() {
      isDrawing = false;
      startX = 0;
    },
  };
}
