// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 系统提示词组装（2026-11-18 从 `MessageContextPipeline` 外移，拆分批 5）
 *
 * 只做"把系统提示拼出来"这一件事：三段规则常量（通用 / 本地模型 / 图像链）+ 工作区根段
 * + `prompt_snippet` 动态段 + 会话目标与记忆上下文，最终交给 `PromptAssembler`。
 *
 * 与同目录其它模块的关系：本模块是**消费方**——截断/摘要/标签处理都在各自模块里，
 * 这里只在组装提示时读取 `session.metadata` 与目标提取结果。
 * 对外符号与实现逐字搬迁，日志 module 名（`chat:context-pipeline`）不变。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { readdirSync } from 'node:fs';
import type { ChatSession } from '@modules/session/types/session.js';
import { isLocalLlmEndpoint } from '../ChatHelper';
// 摘要/目标提取在 `./turnSummary`（本文件组装系统提示时用到目标提取）
import { extractCurrentGoal } from './turnSummary';
import { buildReplyEffortPrompt } from '../../replyEffort';
import { assembleSystemPrompt } from '@openliri/service/services/prompt/PromptAssembler';
import {
  setCurrentKnowledgeQuery,
  setCurrentKnowledgeDomain,
} from '@openliri/service/services/prompt/KnowledgePromptProvider';
import type { MemorySessionContext } from '@openliri/infra/memory/types/SessionContext';
// P0-1（2026-11-25）：长期记忆顶层索引段（只读 MEMORY.md 头部）
import { buildMemoryIndexSection } from '@openliri/infra/memory';
import type { SessionMemoryInjection } from './sessionMemoryInjection';
import type { ImageContextService } from '../ImageContextService';

// P1-3: Skills as User Message injection (not System Prompt, avoids breaking cache_control prefix)
import {
  DANGEROUS_uncachedSystemPromptSection,
  type SystemPromptSection,
} from '@openliri/infra/constants';
// 红线 S3（2026-11-15）：prompt_snippet 动态段（默认关闭）
import { buildPromptSnippetSection } from '@modules/context';

const logger = getLogger('chat:context-pipeline');

/** 系统提示词中的上下文保持 + 行为约束规则 */
const MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。若需要回顾用户信息，请使用 recall_memory 工具查询（默认披露面未直接列出时，先用 tool_search 的 select:recall_memory 找到它再调用）。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离（强制标签格式）**：你的每次回复必须按以下格式组织：
   \`\`\`
   <think>
   内部推理过程 - 工具调用计划、代码分析、文件查找。用户不可见。
   </think>
   <response>
   给用户看的最终回答。禁止重复 think 中的规划步骤。
   </response>
   \`\`\`
   **严格规则**：
   - <think> 标签内：放所有推理、规划、文件查找过程、代码分析、步骤描述
   - <response> 标签内：放最终用户可见的回答，简明扼要，禁止重复 think 中的规划描述
   - **禁止**在 <response> 标签外输出任何内容
   - **禁止**在 <response> 中泄漏"我先看看结构""让我分析一下"等内部规划语言
   - 如果本轮不需要推理（如简单问候），可省略 <think> 直接输出 <response> 内容
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **先分析再提问，区分开放式/封闭式问题**：使用 ask_user_question 工具前，必须先输出实质性分析/方案/计划让用户了解当前进展。禁止在未输出任何实质性内容的情况下直接调用 ask_user_question 向用户提问。选项中不应包含"继续"等暗示已有方案的模糊标签。**开放性问题（无法穷举选项的，如"你想做什么？""目标是什么？"）不要用 ask_user_question 工具，直接在正文中以自然语言提问即可。
5. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
6. **直接行动，禁止无信息量确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？"等无信息量的确认性问题。但在**真实决策点**（需求存在多义、方案需要用户选择方向、任务卡在关键岔路、执行结果与预期不符需要用户拍板时）**允许使用 ask_user_question 工具**提出有实质选项的封闭式问题（如"接下来优先推进哪个方向？"），选项必须具体可执行，禁止"继续/跳过/都行"等空泛标签。做完后直接输出结果即可。
7. **任务隔离**：仅响应最新一条用户消息提出的任务。对话历史中较早的用户请求和工具调用已全部完成，**禁止**重新执行、延续或引用历史请求中的工具调用（如图片生成、文件分析等），除非最新用户消息明确要求。`;

/** 本地模型（llama.cpp/Ollama）精简版行为约束 — 与 MEMORY_CONTEXT_RULES 差异：
 * 第 2 条去掉强制 <think>/<response> 标签格式（本地推理模型 R1 等有原生思考通道，
 * Liri 已自动提取 thinking，强制标签会让模型把标签输出到正文），改为"思考通道分离"表述 */
const LOCAL_MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离**：推理、规划、分析等过程只放入思考通道（thinking），正文只输出对用户的最终回答。禁止在正文泄漏"我先看看结构""让我分析一下"等内部规划语言。如果本轮不需要推理（如简单问候），直接输出回答即可。
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
5. **直接行动，禁止无信息量确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？"等无信息量的确认性问题。做完后直接输出结果即可。
6. **任务隔离**：仅响应最新一条用户消息提出的任务。对话历史中较早的用户请求和工具调用已全部完成，**禁止**重新执行、延续或引用历史请求中的工具调用，除非最新用户消息明确要求。`;

/** 图像工具链式操作指南 */
const IMAGE_CHAIN_RULES = `## 图像工具链式操作
当用户请求涉及多个图像操作时（如"生成一张图，然后编辑它，再分析一下"），你可以在单次回复中**依次调用多个工具**组成链式操作。规则如下：

1. **识别链式意图**：用户消息中包含"然后""再""接着""并且"等连接词，通常表示多个操作意图。
2. **顺序执行**：按用户描述的顺序依次调用工具，**前一个工具的输出路径作为后一个工具的 inputPath**。
3. **路径传递**：
   - image_generate 返回 images[0].filePath → 作为后续 image/image_analysis 的 inputPath
   - image 返回 outputPath → 作为后续工具的 inputPath
   - canvas export 返回 outputPath → 作为后续工具的 inputPath
4. **常见链式模式**：
   - 生成 → 编辑：先 image_generate 生成图片，再 image 进行裁剪/调色/加水印等
   - 生成 → 分析：先 image_generate 生成图片，再 image_analysis 分析内容
   - 编辑 → 分析：先 image 编辑图片，再 image_analysis 分析结果
   - 生成 → 画布标注：先 image_generate 生成底图，再 canvas import 后在画布上标注
5. **错误处理**：如果链中某一步失败，报告失败原因并停止后续步骤。不要默默跳过失败继续。`;

// ============================================================
// 纯函数
// ============================================================

// 2026-11-18（§48 拆分批 2）：`sanitizeApiMessages` / `compressToolHistory` 已外移到
// `./context/messageSanitizer`（本文件只 import 使用，不再自带实现）。

// 2026-11-18（§48 拆分批 3）：`persistTurnSummary` / `extractCurrentGoal` 已外移到
// `./context/turnSummary`。

// 参数化函数
// ============================================================

// 2026-11-18（§48 拆分批 4）：截断簇（`truncateApiMessages` / 分页切点 / 精确 token 截断）
// 已外移到 `./context/contextTruncation`。

/**
 * 列出工作区根下的**一级目录**（只读事实；失败回落空数组）。
 *
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30` 复盘，P3）：模型被告诉"相对路径基准是仓库根"，
 * 但真实工程根是 `app/`，于是每轮都要先探一层目录（真机白耗 1–2 轮）。一级目录是**确定性事实**，
 * 直接写进工作区段比让模型自己试更省。
 *
 * 过滤 `node_modules` / `.git`（与本任务无关且可能极大）；其余（含 `.trae` 等）照列。
 * 上限 `limit`（默认 24）防止超宽目录把提示词撑大；按名称排序保证可复现。
 */
export function listTopLevelDirs(root: string, limit = 24): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (d) => d.isDirectory() && d.name !== 'node_modules' && d.name !== '.git'
      )
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);
  } catch {
    // @ignore-catch — 目录不可读/不存在 ⇒ 不注入目录事实（不臆造）
    return [];
  }
}

/**
 * 会话工作区提示段（2026-11-10，纯函数）。
 *
 * 聊天链此前**从没告诉模型**相对路径的基准在哪 ⇒ 模型按代码仓习惯写绝对路径，
 * 越界写按策略走确认（真机 demand：2 次 ask 全部来自写到 `E:\…\PY_APP\index.html`）。
 *
 * 2026-11-24（P3）：可附带**一级目录**（由 {@link listTopLevelDirs} 提供，纯函数便于单测）——
 * 让模型一次看清目录布局，不必为"代码根在哪"先探一轮。
 *
 * 空/缺失工作区 ⇒ 空串 ⇒ 不注入（裸会话的 cwd 由运行形态决定，不给出不实基准）。
 */
export function buildWorkspaceRootSection(
  workspaceRoot?: string,
  topLevelDirs?: readonly string[]
): string {
  if (!workspaceRoot) return '';
  const lines = [
    '## 会话工作区',
    `- 本会话工具的相对路径基准：\`${workspaceRoot}\``,
    '- 新建/修改产物请写在该目录内（用相对路径）；写到该目录之外会触发人工确认或被拒绝。',
  ];
  if (topLevelDirs && topLevelDirs.length > 0) {
    lines.push(
      `- 该目录下的一级目录（只读事实，按名称排序）：${topLevelDirs
        .map((d) => `\`${d}\``)
        .join('、')}`
    );
    lines.push(
      '- 若代码主工程不在工作区根本身，请按上面的目录判断真实工程根，不要按"仓库根 = 工程根"的习惯猜路径。'
    );
  }
  return lines.join('\n');
}

/**
 * 获取或组装系统提示词
 * 每次根据当前会话状态重新组装（包含动态段落如 sessionContext）
 *
 * @param session 当前会话
 * @param currentMessage 当前用户消息
 * @param llmClient LLM 客户端（用于获取 providerId）
 * @param imageContextService 图片上下文服务
 */
export async function assembleContextualSystemPrompt(
  session: ChatSession,
  currentMessage: string | undefined,
  llmClient: { getProviderId(): string; getBaseUrl?(): string } | undefined,
  imageContextService: ImageContextService,
  /**
   * 会话记忆注入内容（P0-1，2026-11-25）：由 `buildSessionMemoryInjection` 产出 ——
   * 预算内为原文，超预算为索引；空 text ⇒ 不注入。
   */
  getSessionMemory?: (sessionId: string) => SessionMemoryInjection,
  /**
   * TR-12-B（2026-09-22）：逐段解析结果透出（含实际 mode），供
   * `RequestSnapshotService` 落"模型输入快照" —— 让"模型当时看到的系统提示词"
   * 可从事件重建（project_rules §1.6 红线）。可选，缺省零影响。
   */
  onSectionsResolved?: (
    sections: SystemPromptSection[],
    contents: (string | null)[],
    mode: string
  ) => void,
  /**
   * 2026-11-10（指标 2 归因）：会话工作区（绝对路径）解析器。
   *
   * 聊天链此前**从没告诉模型**相对路径的基准在哪 ⇒ 模型按代码仓习惯写绝对路径，
   * 越界守卫按策略走确认（真机 demand：2 次 ask 全来自写到 `E:\…\PY_APP\index.html`）。
   * 只在解析出**显式工作区**时注入；裸会话的 cwd 由运行形态决定，不给出不实基准。
   */
  getSessionWorkspacePath?: (sessionId: string) => string | undefined
): Promise<string> {
  const providerId = llmClient?.getProviderId() || '';
  // 本地模型判定：baseUrl 指向 localhost/127.0.0.1 → 启用精简 system prompt
  const baseUrl =
    typeof llmClient?.getBaseUrl === 'function' ? llmClient.getBaseUrl() : '';
  const isLocal = baseUrl ? isLocalLlmEndpoint(baseUrl) : false;
  const sessionContext: MemorySessionContext = {
    sessionId: session.id,
    turnCount: session.messages.length,
    duration: Date.now() - (session.createdAt?.getTime() ?? Date.now()),
    startedAt: session.createdAt?.getTime() ?? Date.now(),
    tags: session.metadata?.tags,
    projectId: (session.metadata as Record<string, unknown> | undefined)
      ?.projectId as string | undefined,
  };

  if (currentMessage) {
    setCurrentKnowledgeQuery(currentMessage);
  }

  // S5 / issue #15（2026-10-29）：域来源 = 会话 `metadata.domain`（持久化标记，见 CS02）。
  // **每轮覆盖式设置（含清空）** —— 该状态是模块级单例，不清空会把上一个会话的域带过来。
  // 合法性校验在消费侧（`knowledgeContext` 段）统一做，此处只透传原始值。
  setCurrentKnowledgeDomain(
    (session.metadata as Record<string, unknown> | undefined)?.domain as
      | string
      | undefined
  );

  // P0-1（提示词分层治理）：旁路内容注册为动态段（cacheBreak=true），随统一组装进入
  // stable/dynamic 分区与 SystemPromptReport——不再在组装后游离手工拼接（曾破坏
  // 前缀缓存且统计不到 token）。
  const sessionMemory = getSessionMemory?.(session.id);
  const memorySectionText = (() => {
    if (!sessionMemory || sessionMemory.text.length === 0) return '';
    // P0-1（2026-11-25）：超预算 ⇒ 只注入索引 + 召回提示（此时"无需 recall_memory"的
    // 旧注意项必须撤掉，否则与降级语义相反）。
    if (sessionMemory.mode === 'index') {
      return [
        '## 会话记忆（自动维护）',
        sessionMemory.text,
        '',
        '**使用规则**：',
        '- 不要凭印象补全未检索到的细节',
      ].join('\n');
    }
    return [
      '## 会话记忆（自动维护）',
      '以下是从本会话中自动提取的关键信息，用于保持长对话上下文连续性：',
      sessionMemory.text,
      '',
      '**使用规则**：',
      '- 优先信任此记忆中的"决策记录"和"文件变更"，它们是已确认的事实',
      '- "关键讨论"部分是摘要，如需精确引用请使用 recall_memory 工具搜索原文（未直接可见时先用 tool_search 查找）',
      '- 不要重复记忆中已有的信息，除非用户明确要求',
      '',
      '**注意**：以下信息来自 memory.md，**无需使用 recall_memory 工具查询**——这些信息已经自动注入到此提示词中。',
      '记忆可能已过期；与当前代码/用户说法冲突时，以当前事实为准。',
    ].join('\n');
  })();

  const currentGoalText = extractCurrentGoal(session, currentMessage);
  const imageContextText = imageContextService.buildImageContextPrompt(
    session.id
  );
  // 本地模型：用精简版行为约束 + 跳过图像链式规则（image 工具已被裁剪，属死规则）
  const contextRules = isLocal
    ? LOCAL_MEMORY_CONTEXT_RULES
    : MEMORY_CONTEXT_RULES;

  const extraDynamicSections: SystemPromptSection[] = [];
  if (currentGoalText) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'currentGoal',
        () =>
          `## 当前会话目标\n你正在协助用户完成以下任务。对话中可能包含较早的无关话题，请以当前目标为准：\n\n${currentGoalText}`,
        '每轮随用户消息提取，动态变化'
      )
    );
  }
  // P0-1（2026-11-25）：长期记忆顶层索引 —— 只注入 `MEMORY.md` 头部（默认 200 行 / 25KB），
  // 其余靠 recall_memory 按需检索；索引缺失/为空/无条目 ⇒ 空串 ⇒ 零注入。
  const memoryIndexText = buildMemoryIndexSection();
  if (memoryIndexText) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'memoryIndex',
        () => memoryIndexText,
        '长期记忆顶层索引（MEMORY.md，维护期重建）'
      )
    );
  }
  if (memorySectionText) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'sessionMemory',
        () => memorySectionText,
        '会话记忆内容随会话增长变化'
      )
    );
  }
  extraDynamicSections.push(
    DANGEROUS_uncachedSystemPromptSection(
      'contextKeepRules',
      () => contextRules,
      '上下文保持/行为约束（本地与远程两版差异）'
    )
  );
  // 2026-10-22（`/effort` 后端接线）：会话 metadata.effortLevel → 回复详略指令。
  // `auto` / 未设置 ⇒ 空串 ⇒ 不注入（零行为变更）。放在行为约束之后，
  // 避免被上面"输出行为约束"的强格式要求覆盖。
  const effortText = buildReplyEffortPrompt(session.metadata?.effortLevel);
  if (effortText) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'replyEffort',
        () => effortText,
        '回复详略档（/effort 设置，随会话变化）'
      )
    );
  }
  if (imageContextText) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'imageContext',
        () => imageContextText,
        '图片上下文随消息变化'
      )
    );
  }
  // 2026-11-10：会话工作区（仅显式工作区时注入）—— 让模型知道相对路径基准，
  // 避免"照代码仓习惯写绝对路径 ⇒ 越界 ⇒ 弹审批"（指标 2 的唯一实证来源）。
  // 2026-11-24（P3）：附带一级目录，免去"先探一层才知道代码根在哪"。
  const workspaceRoot = getSessionWorkspacePath?.(session.id);
  const workspaceSection = buildWorkspaceRootSection(
    workspaceRoot,
    workspaceRoot ? listTopLevelDirs(workspaceRoot) : undefined
  );
  if (workspaceSection) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'workspaceRoot',
        () => workspaceSection,
        '会话工作区随会话设置变化'
      )
    );
  }
  if (!isLocal) {
    extraDynamicSections.push(
      DANGEROUS_uncachedSystemPromptSection(
        'imageChainRules',
        () => IMAGE_CHAIN_RULES,
        '图像链式操作指南（image 工具被裁剪时移除）'
      )
    );
  }
  // 红线 S3（2026-11-15）：prompt_snippet —— **默认关闭**（LIRI_PROMPT_SNIPPET=1 才注入）；
  // 关闭时返回 null ⇒ 不追加任何段，装配结果与今天逐字一致。
  const promptSnippetSection = buildPromptSnippetSection();
  if (promptSnippetSection) {
    extraDynamicSections.push(promptSnippetSection);
  }

  const prompt = await assembleSystemPrompt({
    providerId,
    sessionContext,
    mode: isLocal ? 'local' : 'conversation',
    extraDynamicSections,
    // TR-12-B：把逐段内容与"实际 mode"一起透出（mode 在此处才最终确定）
    onSectionsResolved: onSectionsResolved
      ? (sections, contents) =>
          onSectionsResolved(
            sections,
            contents,
            isLocal ? 'local' : 'conversation'
          )
      : undefined,
  });

  if (isLocal) {
    logger.info(
      'assembleContextualSystemPrompt: 本地模型启用精简 system prompt',
      {
        baseUrl,
        providerId,
        mode: 'local',
        skippedSections: [
          'taskNegotiation',
          'shellDeclaration',
          'toolIntegrity',
        ],
        memoryRules: 'local(无强制think/response标签)',
        imageChainRules: false,
      }
    );
  }

  return prompt;
}

// 2026-11-18（§48 拆分批 3）：`ensureThinkResponseTags` / `stripThinkResponseTags` /
// `stripOrphanToolTags` 已外移到 `./context/thinkTags`。
