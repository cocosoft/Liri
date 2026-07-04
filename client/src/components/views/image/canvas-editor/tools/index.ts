// canvas-editor/tools/index.ts — 工具注册表

import { CanvasTool } from "../types";
import { CanvasToolHandler } from "./base";
import { PencilTool } from "./PencilTool";
import { EraserTool } from "./EraserTool";
import { createShapeTool } from "./ShapeTool";
import { FillTool } from "./FillTool";
import { EyedropperTool } from "./EyedropperTool";
import { TextTool } from "./TextTool";
import { PanTool } from "./PanTool";
import { SelectTool } from "./SelectTool";
import { LassoSelectTool } from "./LassoSelectTool";

const toolMap = new Map<CanvasTool, CanvasToolHandler>();
toolMap.set("pencil", new PencilTool());
toolMap.set("eraser", new EraserTool());
toolMap.set("line", createShapeTool("line", "line"));
toolMap.set("arrow", createShapeTool("arrow", "arrow"));
toolMap.set("rect", createShapeTool("rect", "rect"));
toolMap.set("roundedRect", createShapeTool("roundedRect", "roundedRect"));
toolMap.set("ellipse", createShapeTool("ellipse", "ellipse"));
toolMap.set("polygon", createShapeTool("polygon", "polygon"));
toolMap.set("star", createShapeTool("star", "star"));
toolMap.set("fill", new FillTool());
toolMap.set("eyedropper", new EyedropperTool());
toolMap.set("text", new TextTool());
toolMap.set("pan", new PanTool());
toolMap.set("select", new SelectTool());
toolMap.set("lasso", new LassoSelectTool());

export function getTool(id: CanvasTool): CanvasToolHandler | undefined {
  return toolMap.get(id);
}

export function getAllTools(): CanvasToolHandler[] {
  return Array.from(toolMap.values());
}
