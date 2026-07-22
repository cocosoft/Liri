// canvas-editor/tools/EyedropperTool.ts — 取色器

import { CanvasTool, CanvasPointerEvent } from "../types";
import { CanvasToolHandler, ToolContext } from "./base";

export class EyedropperTool implements CanvasToolHandler {
  readonly id: CanvasTool = "eyedropper";
  readonly cursor = "crosshair";

  private previousTool: CanvasTool | null = null;

  onActivate(ctx: ToolContext) {
    this.previousTool =
      ctx.state.activeTool === "eyedropper" ? "pencil" : ctx.state.activeTool;
  }
  onPointerDown(_e: CanvasPointerEvent, _ctx: ToolContext) {}
  onPointerMove(_e: CanvasPointerEvent, _ctx: ToolContext) {}

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext) {
    const pixel = ctx.buffer.getImageData(
      Math.round(e.x),
      Math.round(e.y),
      1,
      1,
    ).data;
    const hex =
      "#" +
      [pixel[0], pixel[1], pixel[2]]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    ctx.state.fgColor = hex;
    ctx.setActiveTool(this.previousTool || "pencil");
  }
}
