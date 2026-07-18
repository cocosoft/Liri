/**
 * ComputerUseTool — 桌面自动化工具
 * 提供截图、鼠标、键盘、剪贴板、窗口管理等桌面自动化能力
 * 底层封装 WindowsComputerUseAdapter（PowerShell 实现）
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { getComputerUseAdapter } from '../../utils/computerUse';
import type {
  ComputerUseAdapter,
  ScreenshotResult,
  MousePosition,
} from '../../utils/computerUse/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:ComputerUseTool:ComputerUseTool', level: LogLevel.INFO });

/**
 * ComputerUse 操作参数
 */
export interface ComputerUseInput {
  action:
    | 'screenshot'
    | 'mouseMove'
    | 'mouseClick'
    | 'mouseDoubleClick'
    | 'mouseRightClick'
    | 'mouseScroll'
    | 'getMousePos'
    | 'keyboardType'
    | 'keyPress'
    | 'keyCombination'
    | 'mouseDown'
    | 'mouseUp'
    | 'drag'
    | 'zoom'
    | 'getClipboard'
    | 'setClipboard'
    | 'getWindows'
    | 'getFrontmostWindow'
    | 'getDisplaySize'
    | 'getAllDisplays'
    | 'launchApp'
    | 'keyHold';
  x?: number;
  y?: number;
  startX?: number;
  startY?: number;
  text?: string;
  key?: string;
  button?: 'left' | 'right' | 'middle';
  deltaX?: number;
  deltaY?: number;
  quality?: number;
  durationMs?: number;
}

export class ComputerUseTool extends BaseTool {
  name = 'computer_use';

  description =
    'Desktop automation tool supporting Windows, macOS and Linux. Supports screenshot, mouse control, keyboard input, clipboard access, and window/application management.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: [
        'screenshot',
        'mouseMove',
        'mouseClick',
        'mouseDoubleClick',
        'mouseRightClick',
        'mouseScroll',
        'getMousePos',
        'keyboardType',
        'keyPress',
        'keyCombination',
        'mouseDown',
        'mouseUp',
        'drag',
        'zoom',
        'getClipboard',
        'setClipboard',
        'getWindows',
        'getFrontmostWindow',
        'getDisplaySize',
        'getAllDisplays',
        'launchApp',
        'keyHold',
      ],
      description: 'The action to perform on the desktop',
      required: true,
    },
    {
      name: 'x',
      type: 'number',
      description: 'X coordinate (required for mouseMove/mouseClick/drag)',
      required: false,
    },
    {
      name: 'y',
      type: 'number',
      description: 'Y coordinate (required for mouseMove/mouseClick/drag)',
      required: false,
    },
    {
      name: 'startX',
      type: 'number',
      description: 'Start X coordinate for drag operation',
      required: false,
    },
    {
      name: 'startY',
      type: 'number',
      description: 'Start Y coordinate for drag operation',
      required: false,
    },
    {
      name: 'text',
      type: 'string',
      description:
        'Text content (required for keyboardType/setClipboard/launchApp)',
      required: false,
    },
    {
      name: 'key',
      type: 'string',
      description:
        'Key or key combination (e.g., ENTER, "ctrl+c", "alt+tab" for keyCombination)',
      required: false,
    },
    {
      name: 'button',
      type: 'string',
      enum: ['left', 'right', 'middle'],
      description: 'Mouse button for click actions (default: left)',
      required: false,
    },
    {
      name: 'deltaX',
      type: 'number',
      description: 'Horizontal scroll amount (for mouseScroll)',
      required: false,
    },
    {
      name: 'deltaY',
      type: 'number',
      description: 'Vertical scroll amount (for mouseScroll)',
      required: false,
    },
    {
      name: 'quality',
      type: 'number',
      description: 'Screenshot JPEG quality (0-1, default 0.75)',
      required: false,
      default: 0.75,
    },
  ];

  override shouldDefer = false;
  override alwaysLoad = true;

  /**
   * 获取桌面自动化适配器实例
   */
  private getAdapter(): ComputerUseAdapter {
    return getComputerUseAdapter();
  }

  async execute(
    input: ComputerUseInput,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const adapter = this.getAdapter();

      if (!adapter.isSupported()) {
        return {
          success: false,
          error:
            'ComputerUse is only supported on Windows, macOS and Linux platforms',
        };
      }

      switch (input.action) {
        case 'screenshot':
          return await this.handleScreenshot(adapter, input);
        case 'mouseMove':
          return await this.handleMouseMove(adapter, input);
        case 'mouseClick':
          return await this.handleMouseClick(adapter, input);
        case 'mouseDoubleClick':
          return await this.handleMouseDoubleClick(adapter, input);
        case 'mouseRightClick':
          return await this.handleMouseRightClick(adapter, input);
        case 'mouseScroll':
          return await this.handleMouseScroll(adapter, input);
        case 'getMousePos':
          return await this.handleGetMousePos(adapter);
        case 'keyboardType':
          return await this.handleKeyboardType(adapter, input);
        case 'keyPress':
          return await this.handleKeyPress(adapter, input);
        case 'keyCombination':
          return await this.handleKeyCombination(adapter, input);
        case 'mouseDown':
          return await this.handleMouseDown(adapter, input);
        case 'mouseUp':
          return await this.handleMouseUp(adapter, input);
        case 'drag':
          return await this.handleDrag(adapter, input);
        case 'zoom':
          return await this.handleZoom(adapter, input);
        case 'getClipboard':
          return await this.handleGetClipboard(adapter);
        case 'setClipboard':
          return await this.handleSetClipboard(adapter, input);
        case 'getWindows':
          return await this.handleGetWindows(adapter);
        case 'getFrontmostWindow':
          return await this.handleGetFrontmostWindow(adapter);
        case 'getDisplaySize':
          return await this.handleGetDisplaySize(adapter);
        case 'getAllDisplays':
          return await this.handleGetAllDisplays(adapter);
        case 'launchApp':
          return await this.handleLaunchApp(adapter, input);
        case 'keyHold':
          return await this.handleKeyHold(adapter, input);
        default:
          return {
            success: false,
            error: `Unknown action: ${input.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `ComputerUse operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 处理截图操作
   */
  private async handleScreenshot(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    const result: ScreenshotResult = await adapter.takeScreenshot({
      quality: input.quality ?? 0.75,
    });

    const base64 = result.data.toString('base64');
    const size = result.data.length;

    return {
      success: true,
      data: {
        format: result.format,
        width: result.width,
        height: result.height,
        size,
        base64,
      },
      output: `Screenshot captured: ${result.format}, ${result.width}x${result.height}, ${(size / 1024).toFixed(1)}KB`,
    };
  }

  /**
   * 处理鼠标移动操作
   */
  private async handleMouseMove(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (input.x === undefined || input.y === undefined) {
      return { success: false, error: 'x and y are required for mouseMove' };
    }

    await adapter.mouseAction({ type: 'move', x: input.x, y: input.y });

    return {
      success: true,
      output: `Mouse moved to (${input.x}, ${input.y})`,
    };
  }

  /**
   * 处理鼠标点击操作，支持指定位置和按钮
   */
  private async handleMouseClick(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'click',
      x: input.x,
      y: input.y,
      button: input.button ?? 'left',
    });

    const pos =
      input.x !== undefined && input.y !== undefined
        ? ` at (${input.x}, ${input.y})`
        : '';
    return {
      success: true,
      output: `Mouse ${input.button || 'left'}-clicked${pos}`,
    };
  }

  /**
   * 处理鼠标双击操作，支持指定位置和按钮
   */
  private async handleMouseDoubleClick(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'doubleClick',
      x: input.x,
      y: input.y,
      button: input.button ?? 'left',
    });

    const pos =
      input.x !== undefined && input.y !== undefined
        ? ` at (${input.x}, ${input.y})`
        : '';
    return {
      success: true,
      output: `Mouse ${input.button || 'left'}-double-clicked${pos}`,
    };
  }

  /**
   * 处理鼠标右键点击操作
   */
  private async handleMouseRightClick(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'rightClick',
      x: input.x,
      y: input.y,
    });

    const pos =
      input.x !== undefined && input.y !== undefined
        ? ` at (${input.x}, ${input.y})`
        : '';
    return {
      success: true,
      output: `Mouse right-clicked${pos}`,
    };
  }

  /**
   * 处理鼠标滚轮操作
   */
  private async handleMouseScroll(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'scroll',
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
    });

    return {
      success: true,
      output: `Mouse scrolled (deltaX: ${input.deltaX ?? 0}, deltaY: ${input.deltaY ?? 0})`,
    };
  }

  /**
   * 处理获取鼠标位置操作
   */
  private async handleGetMousePos(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const pos: MousePosition = await adapter.getMousePosition();

    return {
      success: true,
      data: pos,
      output: `Mouse position: (${pos.x}, ${pos.y})`,
    };
  }

  /**
   * 处理键盘输入操作
   */
  private async handleKeyboardType(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for keyboardType' };
    }

    await adapter.keyboardAction({ type: 'type', text: input.text });

    return {
      success: true,
      output: `Typed text (${input.text.length} characters)`,
    };
  }

  /**
   * 处理按键操作
   */
  private async handleKeyPress(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'key is required for keyPress' };
    }

    await adapter.keyboardAction({ type: 'keyPress', key: input.key });

    return {
      success: true,
      output: `Key pressed: ${input.key}`,
    };
  }

  /**
   * 处理组合键操作（如 ctrl+c, alt+tab）
   */
  private async handleKeyCombination(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.key) {
      return {
        success: false,
        error: 'key is required for keyCombination (e.g., "ctrl+c", "alt+tab")',
      };
    }

    await adapter.keyboardAction({ type: 'keyCombination', key: input.key });

    return {
      success: true,
      output: `Key combination pressed: ${input.key}`,
    };
  }

  /**
   * 处理按住键操作（按下并保持指定时长后释放）
   */
  private async handleKeyHold(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'key is required for keyHold' };
    }

    const durationMs = input.durationMs ?? 500;

    await adapter.keyboardAction({
      type: 'keyHold',
      key: input.key,
      durationMs,
    });

    return {
      success: true,
      output: `Key held: ${input.key} for ${durationMs}ms`,
    };
  }

  /**
   * 处理鼠标按下操作（拖拽起始）
   */
  private async handleMouseDown(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'mouseDown',
      x: input.x,
      y: input.y,
      button: input.button ?? 'left',
    });

    return {
      success: true,
      output: `Mouse ${input.button || 'left'} button pressed`,
    };
  }

  /**
   * 处理鼠标抬起操作（拖拽结束）
   */
  private async handleMouseUp(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    await adapter.mouseAction({
      type: 'mouseUp',
      x: input.x,
      y: input.y,
      button: input.button ?? 'left',
    });

    return {
      success: true,
      output: `Mouse ${input.button || 'left'} button released`,
    };
  }

  /**
   * 处理拖拽操作（从 (startX, startY) 拖到 (x, y)）
   */
  private async handleDrag(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (
      input.startX === undefined ||
      input.startY === undefined ||
      input.x === undefined ||
      input.y === undefined
    ) {
      return {
        success: false,
        error: 'startX, startY, x, y are required for drag',
      };
    }

    const button = input.button ?? 'left';

    // 1. 移动到起始位置
    await adapter.mouseAction({
      type: 'move',
      x: input.startX,
      y: input.startY,
    });
    await sleep(50);

    // 2. 按下鼠标
    await adapter.mouseAction({ type: 'mouseDown', button });
    await sleep(50);

    // 3. 线性插值移动到目标位置
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(input.startX + (input.x - input.startX) * t);
      const cy = Math.round(input.startY + (input.y - input.startY) * t);
      await adapter.mouseAction({ type: 'move', x: cx, y: cy });
      await sleep(15);
    }

    // 4. 抬起鼠标
    await adapter.mouseAction({ type: 'mouseUp', button });

    return {
      success: true,
      output: `Dragged from (${input.startX}, ${input.startY}) to (${input.x}, ${input.y})`,
    };
  }

  /**
   * 处理区域截图（zoom 操作）
   */
  private async handleZoom(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (
      input.x === undefined ||
      input.y === undefined ||
      input.deltaX === undefined ||
      input.deltaY === undefined
    ) {
      return {
        success: false,
        error: 'x, y, deltaX (width), deltaY (height) are required for zoom',
      };
    }

    const result: ScreenshotResult = await adapter.takeScreenshot({
      quality: input.quality ?? 0.75,
      region: {
        x: input.x,
        y: input.y,
        width: input.deltaX,
        height: input.deltaY,
      },
    });

    const base64 = result.data.toString('base64');
    const size = result.data.length;

    return {
      success: true,
      data: {
        format: result.format,
        width: result.width,
        height: result.height,
        size,
        base64,
        region: {
          x: input.x,
          y: input.y,
          width: input.deltaX,
          height: input.deltaY,
        },
      },
      output: `Region screenshot: (${input.x}, ${input.y}) ${input.deltaX}x${input.deltaY}, ${(size / 1024).toFixed(1)}KB`,
    };
  }

  /**
   * 处理读取剪贴板操作
   */
  private async handleGetClipboard(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const content = await adapter.getClipboard();

    return {
      success: true,
      data: { content, length: content.length },
      output: `Clipboard content (${content.length} chars):\n${content.substring(0, 1000)}${content.length > 1000 ? '\n...(truncated)' : ''}`,
    };
  }

  /**
   * 处理写入剪贴板操作
   */
  private async handleSetClipboard(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for setClipboard' };
    }

    await adapter.setClipboard(input.text);

    return {
      success: true,
      output: `Clipboard set (${input.text.length} characters)`,
    };
  }

  /**
   * 处理获取窗口列表操作
   */
  private async handleGetWindows(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const apps = await adapter.getRunningApps();

    return {
      success: true,
      data: { apps, count: apps.length },
      output: `Running windows (${apps.length}):\n${apps.map((a) => `  - ${a.name}${a.pid ? ` (PID: ${a.pid})` : ''}`).join('\n')}`,
    };
  }

  /**
   * 处理获取前台窗口操作
   */
  private async handleGetFrontmostWindow(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const app = await adapter.getFrontmostApp();

    if (!app) {
      return { success: false, output: 'No foreground window found' };
    }

    return {
      success: true,
      data: app,
      output: `Foreground window: ${app.name}${app.pid ? ` (PID: ${app.pid})` : ''}`,
    };
  }

  /**
   * 处理获取主显示尺寸操作
   */
  private async handleGetDisplaySize(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const geometry = await adapter.getDisplayGeometry();

    return {
      success: true,
      data: geometry,
      output: `Display: ${geometry.width}x${geometry.height}, scale: ${geometry.scaleFactor}`,
    };
  }

  /**
   * 处理获取所有显示器信息操作
   */
  private async handleGetAllDisplays(
    adapter: ComputerUseAdapter
  ): Promise<ToolResult> {
    const displays = await adapter.getAllDisplays();

    return {
      success: true,
      data: { displays, count: displays.length },
      output: `Displays (${displays.length}):\n${displays
        .map(
          (d) =>
            `  - ${d.id}: ${d.width}x${d.height} at (${d.x},${d.y})${d.isPrimary ? ' [Primary]' : ''}`
        )
        .join('\n')}`,
    };
  }

  /**
   * 处理启动应用操作
   */
  private async handleLaunchApp(
    adapter: ComputerUseAdapter,
    input: ComputerUseInput
  ): Promise<ToolResult> {
    if (!input.text) {
      return {
        success: false,
        error: 'text (app path/name) is required for launchApp',
      };
    }

    const ok = await adapter.launchApp(input.text);

    return {
      success: ok,
      output: ok
        ? `Launched application: ${input.text}`
        : `Failed to launch: ${input.text}`,
    };
  }
}

/**
 * 异步延时辅助函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建 ComputerUseTool 实例
 */
export function createComputerUseTool(): ComputerUseTool {
  return new ComputerUseTool();
}
