// __tests__/tools/pencil.test.ts — 画笔工具基线测试

import { describe, it, expect, vi } from "vitest";
import { ToolContext } from "../../tools/base";

// 最小可用 ToolContext mock（pixelmatch 基线留待 CI 阶段）
function makeMockCtx(): ToolContext {
  const bufferCanvas = {
    width: 200,
    height: 200,
    getContext: vi.fn(),
    getImageData: vi.fn(() => new ImageData(200, 200)),
    putImageData: vi.fn(),
    toBlob: vi.fn(() => Promise.resolve(new Blob())),
    toDataURL: vi.fn(() => "data:image/png;base64,test"),
    resize: vi.fn(),
    fillBg: vi.fn(),
    ctx: {
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      stroke: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "round",
      lineJoin: "round",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fill: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D,
  } as unknown as ToolContext["buffer"];

  return {
    buffer: bufferCanvas,
    transform: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      dpr: 1,
      logicalToPixel: (x: number, y: number) => [x, y] as [number, number],
      clientToLogical: (x: number, y: number) => [x, y] as [number, number],
      applyTransform: vi.fn(),
      setZoom: vi.fn(),
    },
    state: {
      width: 200,
      height: 200,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      fitToWindow: false,
      activeTool: "pencil",
      strokeWidth: 2,
      fgColor: "#000000",
      bgColor: "#ffffff",
      toolParams: {},
    },
    commands: {
      execute: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      clear: vi.fn(),
      onChange: vi.fn(),
    },
    setActiveTool: vi.fn(),
    interactiveCtx: null,
    overlayCtx: null,
    overlayCanvas: null as unknown as HTMLCanvasElement,
  };
}

describe("PencilTool", () => {
  it("应该注册在工具列表中", async () => {
    const { getTool } = await import("../../tools/index");
    const tool = getTool("pencil");
    expect(tool).toBeDefined();
    expect(tool?.id).toBe("pencil");
  });

  it("onPointerDown 应初始化 Path2D", async () => {
    const { getTool } = await import("../../tools/index");
    const ctx = makeMockCtx();
    const tool = getTool("pencil");
    tool?.onPointerDown(
      {
        x: 10,
        y: 10,
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        pressure: 1,
      },
      ctx,
    );
    // 不抛异常即通过
  });

  it("onPointerMove + onPointerUp 应产生 undo 命令", async () => {
    const { getTool } = await import("../../tools/index");
    const ctx = makeMockCtx();
    const tool = getTool("pencil");
    const pe = {
      x: 0,
      y: 0,
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      pressure: 1,
    };
    tool?.onPointerDown(pe, ctx);
    tool?.onPointerMove({ ...pe, x: 50, y: 50 }, ctx);
    tool?.onPointerUp(pe, ctx);
    expect(ctx.commands.execute).toHaveBeenCalled();
  });
});
