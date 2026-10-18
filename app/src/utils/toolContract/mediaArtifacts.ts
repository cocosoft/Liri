// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具**媒体产物**声明（A-4，2026-10-18）—— 「结果里哪个字段是产物路径」的**唯一事实源**。
 *
 * 背景：`chat/services/ImageContextService` 原先按工具名写了 8 处分支，各自解析**不同结构**
 * （`image_generate.images[].filePath/localUrl`、`image.outputPath`、`image_svg_generate.savePath`、
 * `canvas.outputPath`、`image_analysis` 的 `args.inputPath`）。分支散落在消费方 ⇒ 新增媒体工具
 * 必须改消费方代码（A-4 要消除的正是这一类）。
 *
 * 设计（CS01：**复用**既有模式）：与 `tools/toolEffects.ts` 的 `TOOL_EFFECTS` 同构 ——
 * 「以 `ToolName` 为键的元数据表 + `resolve*` 取值函数」，**不是**「能力名 → 工具名」反查表；
 * 键取自 `constants/toolNames.generated.ts` 的编译期联合（拼错 ⇒ typecheck 失败）。
 *
 * 置于 `utils`（infra）而非 `tools`（app）：消费方 `chat/services/ImageContextService` 属 app 层，
 * 但 `tools` 是被 `module-registry/no-direct-module-import` 限制的模块域 —— 直接 import 会被
 * ESLint 拒绝（需走 `moduleRegistry.resolve`，为一张纯数据表引入运行时解析不划算）。
 * 与 `utils/toolContract/toolRoles.ts` 同一裁定。
 *
 * 语义边界：本表只描述**产物结构**（路径字段 / 上下文槽位 / 补充字段），不参与权限与风险判定。
 */
import type { ToolName } from '../../constants/toolNames.generated';

/** 会话级「最近图片」槽位 */
export type MediaContextSlot = 'generated' | 'edited' | 'analyzed';

/** 单个工具的媒体产物声明 */
export interface ToolMediaArtifactSpec {
  /** `result` 顶层路径字段（按序取首个非空） */
  readonly resultPathKeys?: readonly string[];
  /** `result` 中的数组字段 → 元素内的路径键（逐元素、逐键收集） */
  readonly resultArray?: {
    readonly field: string;
    readonly pathKeys: readonly string[];
  };
  /** 命中后写入的会话上下文槽位（未声明 ⇒ 不写上下文） */
  readonly contextSlot?: MediaContextSlot;
  /** 槽位补充字段的来源（`args.prompt` / `args.action`） */
  readonly detailKey?: 'prompt' | 'action';
  /** 补充字段缺省值（`canvas` 为 `'export'`） */
  readonly defaultDetail?: string;
  /** 输入路径字段（`image_analysis` 读 `args.inputPath` 而非结果） */
  readonly inputPathKey?: string;
}

/**
 * 媒体工具产物声明（**唯一事实源**）。
 *
 * ⚠️ 新增媒体工具时在此登记；未登记 ⇒ 产物路径不会被登记进会话、上下文也不会更新。
 */
export const TOOL_MEDIA_ARTIFACTS: Partial<
  Record<ToolName, ToolMediaArtifactSpec>
> = {
  image_generate: {
    resultArray: { field: 'images', pathKeys: ['filePath', 'localUrl'] },
    contextSlot: 'generated',
    detailKey: 'prompt',
  },
  image: {
    resultPathKeys: ['outputPath'],
    contextSlot: 'edited',
    detailKey: 'action',
  },
  image_svg_generate: {
    resultPathKeys: ['savePath'],
  },
  canvas: {
    resultPathKeys: ['outputPath'],
    contextSlot: 'edited',
    detailKey: 'action',
    defaultDetail: 'export',
  },
  image_analysis: {
    contextSlot: 'analyzed',
    detailKey: 'action',
    inputPathKey: 'inputPath',
  },
};

/** 取媒体产物声明；未登记（含非媒体工具 / MCP 工具）⇒ `undefined` */
export function resolveMediaArtifacts(
  name: string
): ToolMediaArtifactSpec | undefined {
  return TOOL_MEDIA_ARTIFACTS[name as ToolName];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** 按声明收集产物路径（保序、不去重 —— 与原分支逐字等价） */
export function collectMediaArtifactPaths(
  result: Record<string, unknown>,
  spec: ToolMediaArtifactSpec
): string[] {
  const paths: string[] = [];

  for (const key of spec.resultPathKeys ?? []) {
    const value = nonEmptyString(result[key]);
    if (value) paths.push(value);
  }

  if (spec.resultArray) {
    const items = result[spec.resultArray.field];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        for (const key of spec.resultArray.pathKeys) {
          const value = nonEmptyString(record[key]);
          if (value) paths.push(value);
        }
      }
    }
  }

  return paths;
}

/** 主产物路径：数组取**首个元素的首个路径键**，顶层键取**首个非空** */
export function primaryMediaArtifact(
  result: Record<string, unknown>,
  spec: ToolMediaArtifactSpec
): string | undefined {
  for (const key of spec.resultPathKeys ?? []) {
    const value = nonEmptyString(result[key]);
    if (value) return value;
  }

  if (spec.resultArray) {
    const items = result[spec.resultArray.field];
    const first = Array.isArray(items) ? items[0] : undefined;
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>;
      for (const key of spec.resultArray.pathKeys) {
        const value = nonEmptyString(record[key]);
        if (value) return value;
      }
    }
  }

  return undefined;
}

/** 上下文补充字段（`prompt` / `action`），含声明缺省值；缺省记为 `''`（与原逻辑一致） */
export function mediaArtifactDetail(
  args: Record<string, unknown>,
  spec: ToolMediaArtifactSpec
): string {
  const raw = spec.detailKey ? nonEmptyString(args[spec.detailKey]) : undefined;
  return raw ?? spec.defaultDetail ?? '';
}
