/**
 * U-03（2026-10-19）：**模型可见出参结构**（`outputJsonSchema`）透传回归。
 *
 * 背景：`getToolSchemas()` 长期把 `output_schema` 固定成 `{ content: string }`
 * —— 所有工具对模型都长一个样，模型无从知道真实结果结构。
 * 现约定：工具声明 `outputJsonSchema`（JSON Schema 片段）即下发给模型；
 * 未声明或形状不合法 ⇒ 沿用历史占位（零破坏、不阻断）。
 */
import { describe, expect, it } from 'bun:test';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { CodeAnalysisTool } from '../../src/tools/CodeAnalysisTool/CodeAnalysisTool';
import { CodeAnalysisOutputSchema } from '../../src/tools/CodeAnalysisTool/schemas';
import { GrepTool } from '../../src/tools/GrepTool/GrepTool';
import { GrepOutputSchema } from '../../src/tools/GrepTool/schemas';
import { FileEditTool } from '../../src/tools/FileEditTool/FileEditTool';
import { WebFetchTool } from '../../src/tools/WebFetchTool/WebFetchTool';
import { WebSearchTool } from '../../src/tools/WebSearchTool/WebSearchTool';
import {
  CreateTaskListOutputSchema,
  GetTaskListOutputSchema,
  UpdateTaskStatusOutputSchema,
} from '../../src/tools/TaskOrchestratorTools/schemas';
import {
  TaskCreateListTool,
  TaskGetListTool,
  TaskUpdateStatusTool,
} from '../../src/tools/TaskOrchestratorTools/TaskOrchestratorTools';
import { TaskOutputOutputSchema } from '../../src/tools/TaskOutputTool/schemas';
import { TaskOutputTool } from '../../src/tools/TaskOutputTool/TaskOutputTool';
import { TaskStopOutputSchema } from '../../src/tools/TaskTool/schemas';
import { TaskStopTool } from '../../src/tools/TaskTool/TaskStopTool';
import { ClipboardTool } from '../../src/tools/ClipboardTool/ClipboardTool';
import { SleepTool } from '../../src/tools/SleepTool/SleepTool';
import { ToolSearchOutputSchema } from '../../src/tools/ToolSearchTool/schemas';
import { ToolSearchTool } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { EnterWorktreeOutputSchema } from '../../src/tools/EnterWorktreeTool/schemas';
import { EnterWorktreeTool } from '../../src/tools/EnterWorktreeTool/EnterWorktreeTool';
import { ExitWorktreeOutputSchema } from '../../src/tools/ExitWorktreeTool/schemas';
import { ExitWorktreeTool } from '../../src/tools/ExitWorktreeTool/ExitWorktreeTool';
import { TeamCreateOutputSchema } from '../../src/tools/TeamCreateTool/schemas';
import { TeamCreateTool } from '../../src/tools/TeamCreateTool/TeamCreateTool';
import { TeamDeleteOutputSchema } from '../../src/tools/TeamDeleteTool/schemas';
import { TeamDeleteTool } from '../../src/tools/TeamDeleteTool/TeamDeleteTool';
import { ListPeersOutputSchema } from '../../src/tools/ListPeersTool/schemas';
import { ListPeersTool } from '../../src/tools/ListPeersTool/ListPeersTool';
import { CronCreateTool } from '../../src/tools/ChronosTool/CronCreateTool';
import { CronDeleteTool } from '../../src/tools/ChronosTool/CronDeleteTool';
import { CronListTool } from '../../src/tools/ChronosTool/CronListTool';
import { CronStopTool } from '../../src/tools/ChronosTool/CronStopTool';
import { PDFTool } from '../../src/tools/PDFTool/PDFTool';
import { BrowserTool } from '../../src/tools/BrowserTool/BrowserTool';
import { BrowserToolOutputSchema } from '../../src/tools/BrowserTool/schemas';
import { PlanTool } from '../../src/tools/PlanTool/PlanTool';
import { PlanToolOutputSchema } from '../../src/tools/PlanTool/schemas';
import { ImageGenerateTool } from '../../src/tools/ImageGenerateTool/ImageGenerateTool';
import { DocGenerateTool } from '../../src/tools/DocGenerateTool/DocGenerateTool';
import { KnowledgeSaveTool } from '../../src/tools/KnowledgeSaveTool/KnowledgeSaveTool';
import { AudioPlayTool } from '../../src/tools/AudioPlayTool/AudioPlayTool';
import { BroadcastTool } from '../../src/tools/BroadcastTool/BroadcastTool';
import { ImageSvgTool } from '../../src/tools/ImageSvgTool/ImageSvgTool';
import { TTSTool } from '../../src/tools/TTSTool/TTSTool';
import { MonitorTool } from '../../src/tools/MonitorTool/MonitorTool';
import { MusicGenerateTool } from '../../src/tools/MusicGenerateTool/MusicGenerateTool';
import { ImageDisplayTool } from '../../src/tools/ImageDisplayTool/ImageDisplayTool';
import { VideoDisplayTool } from '../../src/tools/VideoDisplayTool/VideoDisplayTool';
import { VideoGenerateTool } from '../../src/tools/VideoGenerateTool/VideoGenerateTool';
import { VoiceOutputTool } from '../../src/tools/VoiceOutputTool/VoiceOutputTool';
import { VoiceOutputOutputSchema } from '../../src/tools/VoiceOutputTool/schemas';
import { BrowserVisionTool } from '../../src/tools/BrowserVisionTool/BrowserVisionTool';
import { VideoAnalysisTool } from '../../src/tools/VideoAnalysisTool/VideoAnalysisTool';
import { CodeRunnerTool } from '../../src/tools/CodeRunner/CodeRunnerTool';
import { ChannelTool } from '../../src/tools/ChannelTool/ChannelTool';
import { TraceRecordingTool } from '../../src/tools/TraceRecordingTool/TraceRecordingTool';
import { ImageAnalysisTool } from '../../src/tools/ImageAnalysisTool/ImageAnalysisTool';
import { ImageTool } from '../../src/tools/ImageTool/ImageTool';
import { VideoTool } from '../../src/tools/VideoTool/VideoTool';
import { MusicTool } from '../../src/tools/MusicTool/MusicTool';
import { SessionsTool } from '../../src/tools/SessionsTool/SessionsTool';
import { SessionsYieldTool } from '../../src/tools/SessionsYieldTool/SessionsYieldTool';
import { CanvasTool } from '../../src/tools/CanvasTool/CanvasTool';
import { SkillViewTool } from '../../src/tools/SkillTool/SkillViewTool';
import {
  createSleepForTool,
  createSleepUntilTool,
} from '../../src/tools/SelfWakeTool/SelfWakeTool';
import { createImageResizeTool } from '../../src/tools/media/ImageResizeTool';
import { createImageCropTool } from '../../src/tools/media/ImageCropTool';
import { createImageRotateTool } from '../../src/tools/media/ImageRotateTool';
import { createImageConvertTool } from '../../src/tools/media/ImageConvertTool';
import { createImageAdjustTool } from '../../src/tools/media/ImageAdjustTool';
import { createImageWatermarkTool } from '../../src/tools/media/ImageWatermarkTool';
import { createMediaInfoTool } from '../../src/tools/media/MediaInfoTool';
import { createVideoCompressTool } from '../../src/tools/media/VideoCompressTool';
import { createVideoExtractAudioTool } from '../../src/tools/media/VideoExtractAudioTool';
import { createVideoExtractThumbnailTool } from '../../src/tools/media/VideoExtractThumbnailTool';
import { createQRGenerateTool } from '../../src/tools/media/QRGenerateTool';
import { createQRDecodeTool } from '../../src/tools/media/QRDecodeTool';
import { createPdfExtractTool } from '../../src/tools/media/PdfExtractTool';
import { createMediaDeleteTool } from '../../src/tools/media/MediaDeleteTool';
import { createMediaDeleteBatchTool } from '../../src/tools/media/MediaDeleteBatchTool';
import { NotebookToolAdapter } from '../../src/tools/adapters/NotebookToolAdapter';
import { BriefTool } from '../../src/tools/BriefTool/BriefTool';
import { FileConvertTool } from '../../src/tools/FileConvertTool/FileConvertTool';
import { SendMessageTool } from '../../src/tools/SendMessageTool/SendMessageTool';
import { GlobTool as SearchGlobTool } from '../../src/tools/search/GlobTool';
import { createKnowledgeSnapshotsTool } from '../../src/knowledge/tools/KnowledgeSnapshotsTool';
import type { Tool } from '../../src/tools/types/Tool';

/** 取 JSON Schema 片段的顶层属性键（排序后便于比较） */
function jsonKeysOf(schema: Record<string, unknown>): string[] {
  return Object.keys(
    (schema.properties ?? {}) as Record<string, unknown>
  ).sort();
}

function stubTool(
  name: string,
  outputJsonSchema?: Record<string, unknown>
): Tool {
  return {
    name,
    description: `${name} demo`,
    params: [],
    outputJsonSchema,
    getInfo: () => ({
      name,
      description: `${name} demo`,
      params: [],
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
    }),
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    execute: async () => ({ status: 'success' }),
  } as unknown as Tool;
}

function schemaOf(tool: Tool) {
  const registry = new ToolRegistry();
  registry.registerTool(tool);
  return registry.getToolSchemas()[0]!;
}

describe('getToolSchemas 出参结构透传（U-03）', () => {
  it('声明了 outputJsonSchema ⇒ 原样下发给模型', () => {
    const declared = {
      type: 'object',
      properties: {
        matches: { type: 'array', description: '命中的记忆' },
        total: { type: 'number' },
      },
    };
    expect(schemaOf(stubTool('demo_declared', declared)).output_schema).toEqual(
      declared
    );
  });

  it('未声明 ⇒ 沿用历史占位 { content: string }', () => {
    expect(schemaOf(stubTool('demo_plain')).output_schema).toEqual({
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Tool execution result content',
        },
      },
    });
  });

  it('形状不合法（非 object/array/标量 / 缺 properties）⇒ 回退占位，不阻断生成', () => {
    for (const bad of [
      { type: 'integer' },
      { type: 'object' },
      { type: 'object', properties: 'not-an-object' },
    ]) {
      const schema = schemaOf(stubTool('demo_bad', bad));
      expect(schema.output_schema.properties).toHaveProperty('content');
    }
  });

  it('数组出参（type: array）⇒ 原样下发（U-03 2026-10-19 扩展）', () => {
    const declared = {
      type: 'array',
      items: { type: 'string', description: '文件路径' },
      description: '匹配到的文件路径列表',
    };
    expect(schemaOf(stubTool('demo_array', declared)).output_schema).toEqual(
      declared
    );
  });

  it('未知类型（如 type: null）⇒ 仍回退占位', () => {
    const schema = schemaOf(stubTool('demo_scalar_bad', { type: 'null' }));
    expect(schema.output_schema.type).toBe('object');
    expect(schema.output_schema.properties).toHaveProperty('content');
  });

  it('数字 / 布尔标量出参原样下发（U-03 2026-10-20 标量扩展）', () => {
    for (const type of ['number', 'boolean'] as const) {
      expect(
        schemaOf(stubTool(`demo_${type}`, { type })).output_schema.type
      ).toBe(type);
    }
  });
});

/**
 * 首批真实工具声明（U-03 2026-10-19）：grep / web_search / code_analysis。
 *
 * 两点必须同时成立：
 * ① 注册快照可读（`getInfo().outputJsonSchema`）—— 懒加载工具未解包也能下发；
 * ② JSON Schema 与 zod 结构**键集一致** —— 防止两处手写漂移（改一处漏一处即红）。
 */
describe('首批真实工具的出参结构（U-03）', () => {
  it('grep：键集与 zod 对齐 + 注册快照可读 + 下发给模型', () => {
    const tool = new GrepTool();

    expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
      Object.keys(GrepOutputSchema.shape).sort()
    );
    expect(schemaOf(tool).output_schema.properties).toHaveProperty(
      'matchCount'
    );
  });

  it('code_analysis：键集与 zod 对齐（含嵌套 analysis）+ 快照可读', () => {
    const tool = new CodeAnalysisTool();
    const declared = tool.getInfo().outputJsonSchema!;

    expect(jsonKeysOf(declared)).toEqual(
      Object.keys(CodeAnalysisOutputSchema.shape).sort()
    );
    const analysis = (
      declared.properties as Record<string, { properties?: object }>
    ).analysis;
    expect(Object.keys(analysis.properties ?? {}).sort()).toEqual([
      'details',
      'stats',
      'type',
    ]);
  });

  it('web_search：results 元素必填项与 WebSearchResult 契约一致', () => {
    const tool = new WebSearchTool();
    const declared = schemaOf(tool).output_schema;
    const results = (
      declared.properties as Record<string, { items?: { required?: string[] } }>
    ).results;

    expect(results.items?.required?.sort()).toEqual([
      'snippet',
      'title',
      'url',
    ]);
    expect(tool.getInfo().outputJsonSchema).toBeDefined();
  });

  it('file_edit：必填只有 filePath/replaced（分支字段标可选，不虚构必填）', () => {
    const tool = new FileEditTool();
    const declared = schemaOf(tool).output_schema as {
      required?: string[];
      properties: Record<string, unknown>;
    };

    expect(declared.required).toEqual(['filePath', 'replaced']);
    expect(
      Object.keys(declared.properties as Record<string, unknown>).sort()
    ).toEqual([
      'filePath',
      'linesChanged',
      'oldStringFound',
      'replaceAll',
      'replaced',
    ]);
  });

  it('web_fetch：字段集与 WebFetchResult 一致（headers 为字符串映射）', () => {
    const tool = new WebFetchTool();
    const declared = schemaOf(tool).output_schema as {
      required?: string[];
      properties: Record<string, { additionalProperties?: unknown }>;
    };

    expect([...(declared.required ?? [])].sort()).toEqual([
      'content',
      'contentLength',
      'contentType',
      'headers',
      'status',
      'statusText',
      'url',
    ]);
    expect(
      (
        declared.properties as Record<
          string,
          { additionalProperties?: unknown }
        >
      ).headers.additionalProperties
    ).toEqual({ type: 'string' });
  });
});

/**
 * 任务族（U-03 2026-10-19）：`create_task_list` / `update_task_status` /
 * `get_task_list` / `task_stop` / `task_output`。五者均已有 zod 出口契约，
 * 这里锁"JSON Schema 键集 = zod 键集"，防止两处手写漂移。
 */
describe('任务族出参结构（U-03）', () => {
  const cases: Array<{
    name: string;
    tool: Tool;
    zod: { shape: Record<string, unknown> };
  }> = [
    {
      name: 'create_task_list',
      tool: new TaskCreateListTool(),
      zod: CreateTaskListOutputSchema,
    },
    {
      name: 'update_task_status',
      tool: new TaskUpdateStatusTool(),
      zod: UpdateTaskStatusOutputSchema,
    },
    {
      name: 'get_task_list',
      tool: new TaskGetListTool(),
      zod: GetTaskListOutputSchema,
    },
    { name: 'task_stop', tool: new TaskStopTool(), zod: TaskStopOutputSchema },
    {
      name: 'task_output',
      tool: new TaskOutputTool(),
      zod: TaskOutputOutputSchema,
    },
  ];

  for (const { name, tool, zod } of cases) {
    it(`${name}：JSON Schema 键集与 zod 对齐`, () => {
      const expected = Object.keys(zod.shape).sort();
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(expected);
      // 快捷键也要真的下发（不是只存在实例上）
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual(expected);
    });
  }
});

/**
 * 第四批（U-03 2026-10-19）：`clipboard` / `sleep` / `tool_search` /
 * `enter_worktree` / `exit_worktree`。前两者无 zod 出口契约 ⇒ 直接锁字段骨架；
 * 后三者与既有 zod 键集对齐。
 */
describe('第四批工具出参结构（U-03）', () => {
  it('clipboard：读/写同型骨架', () => {
    const declared = schemaOf(new ClipboardTool()).output_schema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(declared.required).toEqual([
      'action',
      'content',
      'truncated',
      'length',
    ]);
  });

  it('sleep：durationMs/elapsed 必填，reason 可选', () => {
    const declared = schemaOf(new SleepTool()).output_schema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(declared.required).toEqual(['durationMs', 'elapsed']);
    expect(Object.keys(declared.properties).sort()).toEqual([
      'durationMs',
      'elapsed',
      'reason',
    ]);
  });

  const zodCases: Array<{
    name: string;
    tool: Tool;
    zod: { shape: Record<string, unknown> };
  }> = [
    {
      name: 'tool_search',
      tool: new ToolSearchTool(),
      zod: ToolSearchOutputSchema,
    },
    {
      name: 'enter_worktree',
      tool: new EnterWorktreeTool(),
      zod: EnterWorktreeOutputSchema,
    },
    {
      name: 'exit_worktree',
      tool: new ExitWorktreeTool(),
      zod: ExitWorktreeOutputSchema,
    },
  ];

  for (const { name, tool, zod } of zodCases) {
    it(`${name}：JSON Schema 键集与 zod 对齐`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        Object.keys(zod.shape).sort()
      );
    });
  }
});

/** 第五批（U-03 2026-10-19）：协作面 `team_create` / `team_delete` / `list_peers`。 */
describe('第五批工具出参结构（U-03）', () => {
  const cases: Array<{
    name: string;
    tool: Tool;
    zod: { shape: Record<string, unknown> };
  }> = [
    {
      name: 'team_create',
      tool: new TeamCreateTool(),
      zod: TeamCreateOutputSchema,
    },
    {
      name: 'team_delete',
      tool: new TeamDeleteTool(),
      zod: TeamDeleteOutputSchema,
    },
    {
      name: 'list_peers',
      tool: new ListPeersTool(),
      zod: ListPeersOutputSchema,
    },
  ];

  for (const { name, tool, zod } of cases) {
    it(`${name}：JSON Schema 键集与 zod 对齐`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        Object.keys(zod.shape).sort()
      );
    });
  }

  it('list_peers：peers 元素键集与 PeerInfoSchema 对齐（含枚举）', () => {
    const declared = new ListPeersTool().getInfo().outputJsonSchema!;
    const peers = (
      declared.properties as Record<
        string,
        { items: { properties: Record<string, unknown>; required: string[] } }
      >
    ).peers;

    expect(Object.keys(peers.items.properties).sort()).toEqual([
      'address',
      'id',
      'lastSeen',
      'status',
      'type',
    ]);
    expect(peers.items.required.sort()).toEqual([
      'address',
      'id',
      'status',
      'type',
    ]);
  });
});

/**
 * 第六批（U-03 2026-10-19）：cron 四工具。
 *
 * 注意：`cron_create` / `cron_list` 的 zod 出口契约已于 2026-09-29 删除（与实现漂移），
 * `cron_delete` 的 zod 只声明了 `id`（实际还有 `name`）⇒ 这里锁的是**实际出口形状**。
 */
describe('第六批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'cron_create',
      tool: CronCreateTool.create(),
      keys: ['humanSchedule', 'id', 'name', 'nextRunAt'],
    },
    {
      name: 'cron_delete',
      tool: CronDeleteTool.create(),
      keys: ['id', 'name'],
    },
    {
      name: 'cron_list',
      tool: CronListTool.create(),
      keys: ['count', 'jobs'],
    },
    {
      name: 'cron_stop',
      tool: CronStopTool.create(),
      keys: ['id', 'name', 'nextRunAt', 'state'],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      // 也必须真的下发给模型
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('cron_list：jobs 元素必填集（nextRunAt/lastRunAt 可选）', () => {
    const declared = CronListTool.create().getInfo().outputJsonSchema!;
    const jobs = (
      declared.properties as Record<string, { items: { required: string[] } }>
    ).jobs;

    expect([...jobs.items.required].sort()).toEqual([
      'enabled',
      'id',
      'name',
      'prompt',
      'schedule',
      'silent',
      'state',
    ]);
  });
});

/** 第七批（U-03 2026-10-19）：`pdf` / `browser`。 */
describe('第七批工具出参结构（U-03）', () => {
  it('pdf：生成分支骨架（extract/info 本构建 fail-closed，无载荷）', () => {
    const declared = schemaOf(new PDFTool()).output_schema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    const expected = [
      'filePath',
      'filename',
      'language',
      'pages',
      'sizeBytes',
      'title',
    ];
    expect(Object.keys(declared.properties).sort()).toEqual(expected);
    expect([...(declared.required ?? [])].sort()).toEqual(expected);
  });

  it('browser：键集与 BrowserToolOutputSchema 对齐（data 为任意结构）', () => {
    const tool = new BrowserTool();
    expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
      Object.keys(BrowserToolOutputSchema.shape).sort()
    );
    const declared = schemaOf(tool).output_schema as { required?: string[] };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'message',
      'success',
    ]);
  });
});

/** 第八批（U-03 2026-10-19）：`plan`（含 plan/plans 嵌套结构）。 */
describe('第八批工具出参结构（U-03）', () => {
  it('plan：键集与 PlanToolOutputSchema 对齐且真的下发', () => {
    const tool = new PlanTool();
    const keys = Object.keys(PlanToolOutputSchema.shape).sort();

    expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(keys);
    expect(schemaOf(tool).output_schema.properties).toHaveProperty('plan');
    expect(
      Object.keys(
        schemaOf(tool).output_schema.properties as Record<string, unknown>
      ).sort()
    ).toEqual(keys);
  });

  it('plan：嵌套 steps 必填集与步骤类型枚举', () => {
    const declared = new PlanTool().getInfo().outputJsonSchema!;
    const plan = (
      declared.properties as Record<
        string,
        { required: string[]; properties: Record<string, unknown> }
      >
    ).plan;
    const steps = plan.properties.steps as {
      items: {
        required: string[];
        properties: Record<string, { enum?: string[] }>;
      };
    };

    expect([...plan.required].sort()).toEqual([
      'created_at',
      'description',
      'id',
      'name',
      'status',
      'steps',
      'updated_at',
    ]);
    expect([...steps.items.required].sort()).toEqual([
      'description',
      'id',
      'name',
      'params',
      'type',
    ]);
    expect(steps.items.properties.type.enum).toEqual([
      'tool',
      'command',
      'condition',
      'loop',
    ]);
  });
});

/** 第九批（U-03 2026-10-19）：媒体/文档/知识/播报面。 */
describe('第九批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'image_generate',
      tool: new ImageGenerateTool(),
      keys: [
        'costBreakdown',
        'costEstimates',
        'durationMs',
        'images',
        'model',
        'params',
        'providerErrors',
        'totalCostUsd',
        'usedProvider',
      ],
    },
    {
      name: 'doc_generate',
      tool: new DocGenerateTool(),
      keys: ['fileName', 'filePath', 'size', 'type'],
    },
    {
      name: 'knowledge_save',
      tool: new KnowledgeSaveTool(),
      keys: ['action', 'filePath', 'message', 'success', 'title'],
    },
    {
      name: 'audio_play',
      tool: new AudioPlayTool(),
      keys: ['audios', 'count'],
    },
    {
      name: 'broadcast',
      tool: new BroadcastTool(),
      keys: ['channel', 'results', 'sent', 'successCount', 'threadId', 'total'],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('image_generate：仅成本字段两分支共有（images 元素必填集固定）', () => {
    const declared = new ImageGenerateTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<string, { items?: { required?: string[] } }>;
    };

    expect([...(declared.required ?? [])].sort()).toEqual([
      'costBreakdown',
      'totalCostUsd',
    ]);
    expect(
      [...(declared.properties.images.items?.required ?? [])].sort()
    ).toEqual(['alt', 'format', 'provider', 'size', 'url']);
  });

  it('doc_generate：create 分支四个字段全部必填', () => {
    const declared = new DocGenerateTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'fileName',
      'filePath',
      'size',
      'type',
    ]);
  });

  it('knowledge_save：写入结果枚举三值', () => {
    const declared = new KnowledgeSaveTool().getInfo().outputJsonSchema! as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(declared.properties.action.enum).toEqual([
      'created',
      'updated',
      'skipped',
    ]);
  });

  it('broadcast：按 action 分支，无根级 required', () => {
    const declared = new BroadcastTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<string, { items?: { required?: string[] } }>;
    };

    expect(declared.required).toBeUndefined();
    expect(
      [...(declared.properties.results.items?.required ?? [])].sort()
    ).toEqual(['channel', 'success']);
  });
});

/** 第十批（U-03 2026-10-19）：`image_svg_generate` / `tts` / `monitor`。 */
describe('第十批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'image_svg_generate',
      tool: new ImageSvgTool(),
      keys: ['filePath', 'model', 'size', 'svg', 'validation'],
    },
    {
      name: 'tts',
      tool: new TTSTool(),
      keys: [
        'audioDurationSec',
        'count',
        'filename',
        'language',
        'speed',
        'textLength',
        'voice',
        'voices',
      ],
    },
    {
      name: 'monitor',
      tool: new MonitorTool(),
      keys: [
        'external',
        'heapTotal',
        'heapTotalMB',
        'heapUsed',
        'heapUsedMB',
        'message',
        'metric',
        'rss',
        'usage',
      ],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('image_svg_generate：svg/model/size 恒必填（filePath/validation 视入参出现）', () => {
    const declared = new ImageSvgTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'model',
      'size',
      'svg',
    ]);
  });

  it('tts：按 action 分支，无根级 required', () => {
    const declared = new TTSTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect(declared.required).toBeUndefined();
  });

  it('monitor：仅 metric 恒必填（其余随指标分支）', () => {
    const declared = new MonitorTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual(['metric']);
  });
});

/** 第十一批（U-03 2026-10-19）：音乐/媒体展示/视频生成/语音输出。 */
describe('第十一批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'music_generate',
      tool: new MusicGenerateTool(),
      keys: ['music', 'params'],
    },
    {
      name: 'image_display',
      tool: new ImageDisplayTool(),
      keys: ['count', 'images'],
    },
    {
      name: 'video_display',
      tool: new VideoDisplayTool(),
      keys: ['count', 'videos'],
    },
    {
      name: 'video_generate',
      tool: new VideoGenerateTool(),
      keys: [
        'cost',
        'durationMs',
        'model',
        'status',
        'taskId',
        'video',
        'videos',
      ],
    },
    {
      name: 'voice_output',
      tool: new VoiceOutputTool(),
      keys: Object.keys(VoiceOutputOutputSchema.shape).sort(),
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('music_generate / image_display / video_display：必填集固定', () => {
    expect(
      (
        new MusicGenerateTool().getInfo().outputJsonSchema as {
          required: string[];
        }
      ).required
    ).toEqual(['music']);
    expect(
      (
        new ImageDisplayTool().getInfo().outputJsonSchema as {
          required: string[];
        }
      ).required.sort()
    ).toEqual(['count', 'images']);
    expect(
      (
        new VideoDisplayTool().getInfo().outputJsonSchema as {
          required: string[];
        }
      ).required.sort()
    ).toEqual(['count', 'videos']);
  });

  it('video_generate / voice_output：无两分支共有的根级必填', () => {
    expect(
      new VideoGenerateTool().getInfo().outputJsonSchema!.required
    ).toBeUndefined();
    expect(
      new VoiceOutputTool().getInfo().outputJsonSchema!.required
    ).toBeUndefined();
  });
});

/** 第十二批（U-03 2026-10-19）：浏览器视觉 / 视频分析 / 代码沙箱。 */
describe('第十二批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'browser_vision',
      tool: new BrowserVisionTool(),
      keys: ['analysis', 'durationMs', 'prompt', 'screenshotPath'],
    },
    {
      name: 'video_analysis',
      tool: new VideoAnalysisTool(),
      keys: ['durationMs', 'frameCount', 'frames', 'summary'],
    },
    {
      name: 'code_run',
      tool: new CodeRunnerTool(),
      keys: [
        'durationMs',
        'error',
        'issues',
        'logs',
        'output',
        'reason',
        'round',
        'scanStatus',
        'status',
        'structuredError',
        'toolCalls',
      ],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('browser_vision：analysis/durationMs/prompt 恒必填', () => {
    const declared = new BrowserVisionTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'analysis',
      'durationMs',
      'prompt',
    ]);
  });

  it('video_analysis：四个字段全必填（失败分支 data 为 null）', () => {
    const declared = new VideoAnalysisTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'durationMs',
      'frameCount',
      'frames',
      'summary',
    ]);
  });

  it('code_run：仅 status 恒必填，且状态/深扫枚举固定', () => {
    const declared = new CodeRunnerTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect([...declared.required!]).toEqual(['status']);
    expect(declared.properties.status.enum).toEqual([
      'completed',
      'failed',
      'compiled-error',
      'security-rejected',
      'timeout',
      'canceled',
    ]);
    expect(declared.properties.scanStatus.enum).toEqual([
      'ran',
      'skipped',
      'failed',
    ]);
  });
});

/** 第十三批（U-03 2026-10-19）：多 action 工具的**分支联合**结构。 */
describe('第十三批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'channel',
      tool: new ChannelTool(),
      keys: [
        'channel',
        'channels',
        'connected',
        'count',
        'disconnected',
        'healthy',
        'level',
        'logs',
        'name',
        'total',
        'type',
      ],
    },
    {
      name: 'trace_recording',
      tool: new TraceRecordingTool(),
      keys: [
        'active',
        'byModel',
        'config',
        'content',
        'errorRate',
        'format',
        'latencyMs',
        'message',
        'monitoringDeps',
        'recordCount',
        'records',
        'tokens',
        'total',
        'totalCalls',
        'totalErrors',
      ],
    },
    {
      name: 'image_analysis',
      tool: new ImageAnalysisTool(),
      keys: [
        'allScores',
        'blocks',
        'colors',
        'comparison',
        'confidence',
        'content',
        'count',
        'depth_image',
        'description',
        'durationMs',
        'imageA',
        'imageB',
        'l2Unavailable',
        'label',
        'language',
        'masks',
        'max_depth',
        'metadata',
        'min_depth',
        'mode',
        'model',
        'objects',
        'scores',
        'similarity',
        'text',
      ],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合分支并集`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });

    it(`${name}：分支并集 ⇒ 无根级 required`, () => {
      expect(tool.getInfo().outputJsonSchema!.required).toBeUndefined();
    });
  }

  it('channel：channels 元素仅 name/type/connected 恒在', () => {
    const declared = new ChannelTool().getInfo().outputJsonSchema! as {
      properties: Record<string, { items: { required: string[] } }>;
    };
    expect([...declared.properties.channels.items.required].sort()).toEqual([
      'connected',
      'name',
      'type',
    ]);
  });

  it('image_analysis：metadata 与 content 子结构必填集固定', () => {
    const declared = new ImageAnalysisTool().getInfo().outputJsonSchema! as {
      properties: Record<
        string,
        { required: string[]; properties: Record<string, unknown> }
      >;
    };
    expect([...declared.properties.metadata.required].sort()).toEqual([
      'filePath',
      'fileSize',
      'format',
    ]);
    expect([...declared.properties.content.required].sort()).toEqual([
      'contentDensity',
      'sharpness',
      'sizeCategory',
    ]);
    expect(
      (
        declared.properties.content.properties.sizeCategory as {
          enum: string[];
        }
      ).enum
    ).toEqual(['icon', 'small', 'medium', 'large', 'wallpaper']);
  });
});

/** 第十四批（U-03 2026-10-19）：媒体编辑 / 会话管理 / 轮次交还。 */
describe('第十四批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'image',
      tool: new ImageTool(),
      keys: [
        'action',
        'aspectRatio',
        'batchResults',
        'format',
        'height',
        'inputPath',
        'originalSize',
        'outputPath',
        'processedSize',
        'width',
      ],
    },
    {
      name: 'video',
      tool: new VideoTool(),
      keys: [
        'action',
        'codec',
        'duration',
        'format',
        'height',
        'inputPath',
        'originalSize',
        'outputPath',
        'processedSize',
        'width',
      ],
    },
    {
      name: 'music',
      tool: new MusicTool(),
      keys: [
        'action',
        'bitrate',
        'codec',
        'duration',
        'format',
        'inputPath',
        'originalSize',
        'outputPath',
        'processedSize',
      ],
    },
    {
      name: 'sessions',
      tool: new SessionsTool(),
      keys: ['action', 'filtered', 'history', 'sessionId', 'sessions', 'total'],
    },
    {
      name: 'sessions_yield',
      tool: new SessionsYieldTool(),
      keys: ['message', 'reason', 'sessionId', 'status', 'timestamp'],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('image / video / music：action + inputPath 恒必填', () => {
    for (const tool of [new ImageTool(), new VideoTool(), new MusicTool()]) {
      const declared = tool.getInfo().outputJsonSchema! as {
        required?: string[];
      };
      expect([...(declared.required ?? [])].sort()).toEqual([
        'action',
        'inputPath',
      ]);
    }
  });

  it('sessions：仅 action 恒必填，且会话/消息元素带枚举与必填集', () => {
    const declared = new SessionsTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<
        string,
        {
          items?: {
            required: string[];
            properties: Record<string, { enum?: string[] }>;
          };
        }
      >;
    };

    expect([...(declared.required ?? [])]).toEqual(['action']);
    expect([...declared.properties.sessions.items!.required].sort()).toEqual([
      'activeTime',
      'name',
      'sessionId',
      'startedAt',
      'status',
      'type',
    ]);
    expect(declared.properties.sessions.items!.properties.status.enum).toEqual([
      'running',
      'paused',
      'completed',
      'failed',
      'killed',
    ]);
  });

  it('sessions_yield：status 契约值固定为 yielded', () => {
    const declared = new SessionsYieldTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'reason',
      'sessionId',
      'status',
      'timestamp',
    ]);
    expect(declared.properties.status.enum).toEqual(['yielded']);
  });
});

/** 第十五批（U-03 2026-10-19）：画布 / 技能查看。 */
describe('第十五批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool; keys: string[] }> = [
    {
      name: 'canvas',
      tool: new CanvasTool(),
      keys: [
        'canvasId',
        'elementCount',
        'format',
        'height',
        'outputPath',
        'width',
      ],
    },
    {
      name: 'skill_view',
      tool: new SkillViewTool(),
      keys: ['content', 'message', 'name', 'source', 'status'],
    },
  ];

  for (const { name, tool, keys } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('canvas：outputPath 仅 export 分支出现（其余五字段恒必填）', () => {
    const declared = new CanvasTool().getInfo().outputJsonSchema! as {
      required?: string[];
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'canvasId',
      'elementCount',
      'format',
      'height',
      'width',
    ]);
  });

  it('skill_view：source 三值枚举，unchanged 分支带 status/message', () => {
    const declared = new SkillViewTool().getInfo().outputJsonSchema! as {
      required?: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect([...(declared.required ?? [])].sort()).toEqual([
      'content',
      'name',
      'source',
    ]);
    expect(declared.properties.source.enum).toEqual([
      'SKILL.md',
      'prompt',
      'unchanged',
    ]);
    expect(declared.properties.status.enum).toEqual(['unchanged']);
  });
});

/** 第十六批（U-03 2026-10-19）：自唤醒计时器（`sleep_for` / `sleep_until` 共用同一实现）。 */
describe('第十六批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool }> = [
    { name: 'sleep_for', tool: createSleepForTool() },
    { name: 'sleep_until', tool: createSleepUntilTool() },
  ];

  for (const { name, tool } of cases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      const keys = ['status', 'triggerAt', 'wakeId'];
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('两个计时器共用同一 schema：wakeId/status 恒必填，status 三值枚举', () => {
    const forSchema = createSleepForTool().getInfo().outputJsonSchema!;
    const untilSchema = createSleepUntilTool().getInfo().outputJsonSchema!;

    expect(forSchema).toEqual(untilSchema);
    expect([...(forSchema.required as string[])].sort()).toEqual([
      'status',
      'wakeId',
    ]);
    expect(
      (forSchema.properties as Record<string, { enum?: string[] }>).status.enum
    ).toEqual(['pending', 'due', 'fired']);
  });
});

/** 第十七批（U-03 2026-10-19）：media 图片处理族（共用 `ProcessResult`）。 */
describe('第十七批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool }> = [
    { name: 'media_image_resize', tool: createImageResizeTool() },
    { name: 'media_image_crop', tool: createImageCropTool() },
    { name: 'media_image_rotate', tool: createImageRotateTool() },
    { name: 'media_image_convert', tool: createImageConvertTool() },
    { name: 'media_image_adjust', tool: createImageAdjustTool() },
    { name: 'media_image_watermark', tool: createImageWatermarkTool() },
  ];

  const keys = [
    'dimensions',
    'error',
    'filePath',
    'originalSize',
    'processedSize',
    'success',
  ];

  for (const { name, tool } of cases) {
    it(`${name}：出参结构可下发且键集符合 ProcessResult`, () => {
      expect(tool.getInfo().outputJsonSchema).toBeDefined();
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('六个图片工具共用同一 schema 引用（单一真源，防副本漂移）', () => {
    const schemas = cases.map(({ tool }) => tool.getInfo().outputJsonSchema);
    for (const schema of schemas) {
      expect(schema).toBe(schemas[0]!);
    }
    expect([...(schemas[0]!.required as string[])].sort()).toEqual([
      'filePath',
      'originalSize',
      'processedSize',
      'success',
    ]);
  });
});

/** 第十八批（U-03 2026-10-19）：`media_info`（MediaFileInfo 投影）。 */
describe('第十八批工具出参结构（U-03）', () => {
  it('media_info：键集与必填集符合 MediaFileInfo 投影', () => {
    const tool = createMediaInfoTool();
    const keys = ['createdAt', 'dimensions', 'fileSize', 'format'];

    expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
      [...keys].sort()
    );
    expect(
      Object.keys(
        schemaOf(tool).output_schema.properties as Record<string, unknown>
      ).sort()
    ).toEqual([...keys].sort());
    expect(
      [...(tool.getInfo().outputJsonSchema!.required as string[])].sort()
    ).toEqual(['createdAt', 'fileSize', 'format']);
  });
});

/** 第十九批（U-03 2026-10-19）：`ToolSchema` 放宽后的**数组出参**真实工具。 */
describe('第十九批工具出参结构（U-03）', () => {
  const cases: Array<{ name: string; tool: Tool }> = [
    { name: 'glob', tool: new SearchGlobTool() },
    { name: 'knowledge_snapshots', tool: createKnowledgeSnapshotsTool() },
  ];

  for (const { name, tool } of cases) {
    it(`${name}：数组出参原样下发（不发生占位回退）`, () => {
      expect(tool.getInfo().outputJsonSchema!.type).toBe('array');
      const delivered = schemaOf(tool).output_schema;
      expect(delivered.type).toBe('array');
      expect((delivered.items as { type?: string } | undefined)?.type).toBe(
        'string'
      );
      // 占位回退是 object + properties.content ⇒ 这里必须没有 properties
      expect(delivered.properties).toBeUndefined();
    });
  }
});

/**
 * 第二十批（U-03 2026-10-20）：media 其余 8 个工具补齐 `data` 后的出参结构；
 * `notebook` 多 action 分支并集（`list` 分支的 `data` 已由裸数组归一为对象）。
 */
describe('第二十批工具出参结构（U-03）', () => {
  /** 单文件产出族（4 个工具共用 `MEDIA_FILE_OUTPUT_JSON_SCHEMA`） */
  const fileCases: Array<{ name: string; tool: Tool }> = [
    { name: 'media_video_compress', tool: createVideoCompressTool() },
    { name: 'media_video_extract_audio', tool: createVideoExtractAudioTool() },
    {
      name: 'media_video_extract_thumbnail',
      tool: createVideoExtractThumbnailTool(),
    },
    { name: 'media_qr_generate', tool: createQRGenerateTool() },
  ];

  it('单文件产出族：共用同一 schema 引用，必填仅 success/filePath/processedSize', () => {
    const schemas = fileCases.map(
      ({ tool }) => tool.getInfo().outputJsonSchema
    );
    for (const schema of schemas) {
      expect(schema).toBe(schemas[0]!);
    }
    expect([...(schemas[0]!.required as string[])].sort()).toEqual([
      'filePath',
      'processedSize',
      'success',
    ]);
    expect(jsonKeysOf(schemas[0]!)).toEqual([
      'captureTime',
      'error',
      'filePath',
      'originalSize',
      'processedSize',
      'success',
    ]);
  });

  for (const { name, tool } of fileCases) {
    it(`${name}：出参结构原样下发（键集与声明一致）`, () => {
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual(jsonKeysOf(tool.getInfo().outputJsonSchema!));
    });
  }

  const singleCases: Array<{
    name: string;
    tool: Tool;
    keys: string[];
  }> = [
    {
      name: 'media_qr_decode',
      tool: createQRDecodeTool(),
      keys: ['success', 'text'],
    },
    {
      name: 'media_pdf_extract',
      tool: createPdfExtractTool(),
      keys: ['pageCount', 'pages', 'success', 'totalSize'],
    },
    {
      name: 'media_delete',
      tool: createMediaDeleteTool(),
      keys: ['filePath', 'success'],
    },
    {
      name: 'media_delete_batch',
      tool: createMediaDeleteBatchTool(),
      keys: ['deletedCount', 'filePaths', 'success', 'total'],
    },
  ];

  for (const { name, tool, keys } of singleCases) {
    it(`${name}：出参结构可下发且键集符合实际出口`, () => {
      expect(jsonKeysOf(tool.getInfo().outputJsonSchema!)).toEqual(
        [...keys].sort()
      );
      expect(
        Object.keys(
          schemaOf(tool).output_schema.properties as Record<string, unknown>
        ).sort()
      ).toEqual([...keys].sort());
    });
  }

  it('notebook：多 action 分支并集下发；根级不设 required；list 分支已归一为对象', () => {
    const tool = new NotebookToolAdapter();
    const declared = tool.getInfo().outputJsonSchema!;

    expect(declared.type).toBe('object');
    expect(declared.required).toBeUndefined();

    const keys = jsonKeysOf(declared);
    // `list` 分支的归一化产物必须可被模型看见
    expect(keys).toContain('notebooks');
    expect(keys).toContain('total');
    expect(keys).toContain('results');

    expect(
      Object.keys(
        schemaOf(tool).output_schema.properties as Record<string, unknown>
      ).sort()
    ).toEqual(keys);
  });
});

/**
 * 第二十一批（U-03 2026-10-20）：`brief` 补结构化 `data`；`nodes` 多 action 分支并集声明。
 */
describe('第二十一批工具出参结构（U-03）', () => {
  it('brief：结构化摘要（summary / messageCount / summaryType）', () => {
    const tool = new BriefTool();
    const declared = tool.getInfo().outputJsonSchema!;

    expect(jsonKeysOf(declared)).toEqual([
      'messageCount',
      'success',
      'summary',
      'summaryType',
    ]);
    expect([...(declared.required as string[])].sort()).toEqual([
      'messageCount',
      'summary',
      'summaryType',
    ]);
    expect(
      Object.keys(
        schemaOf(tool).output_schema.properties as Record<string, unknown>
      ).sort()
    ).toEqual(jsonKeysOf(declared));
  });

  /**
   * U-03（2026-10-20）：`output_schema` 标量扩展 —— `file_convert` 的 `data` 恒为字符串
   * （`outputSchema = z.string()`），此前只能不声明、由模型看到占位 `{content}`。
   */
  it('file_convert：标量出参（string）原样下发，不带 properties', () => {
    const tool = new FileConvertTool();
    const declared = tool.getInfo().outputJsonSchema!;

    expect(declared.type).toBe('string');
    expect(declared.properties).toBeUndefined();

    const delivered = schemaOf(tool).output_schema;
    expect(delivered.type).toBe('string');
    expect(delivered.properties).toBeUndefined();
    expect(delivered.description).toBe(declared.description);
  });

  /**
   * `send_message`（2026-10-20 接线同批）：`data` 是 `JSON.stringify(...)` ⇒ 字符串，
   * 同样用标量声明（不臆造对象结构）。
   */
  it('send_message：标量出参（JSON 文本）原样下发', () => {
    const tool = new SendMessageTool();
    const declared = tool.getInfo().outputJsonSchema!;

    expect(declared.type).toBe('string');
    expect(declared.properties).toBeUndefined();
    expect(schemaOf(tool).output_schema.type).toBe('string');
  });
});
