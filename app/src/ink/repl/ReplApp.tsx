import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, AlternateScreen, useApp } from '../../ink';
import { ConversationArea } from './ConversationArea';
import { InputArea } from './InputArea';
import { handleReplSlashInput } from './slashRoutes';
import { buildCompletedToolCalls } from './toolCallCards';
import { StatusFloatingBar } from './StatusFloatingBar';
import { Header } from './Header';
import { getLogger } from '@openliri/infra/monitoring';
import {
  getTotalCostUSD,
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCacheReadInputTokens,
  getTotalCacheCreationInputTokens,
} from '@openliri/infra/cost';
import type {
  DisplayMessage,
  StreamStats,
  StreamState,
  ToolCallInfo,
} from './types';
import type { ChatManager } from '@modules/chat';
import type {
  ChatStreamChunk,
  QuestionData,
  ToolCallSpec,
} from '@modules/runtime/api/CoreAPI';

const logger = getLogger('ink:repl');

interface ReplAppProps {
  chatManager: ChatManager;
  onExit: () => void;
}

/**
 * T3（2026-11-17）：流结束后刷新路由/模型读数（原样搬出 `handleSubmit` 的 finally 分支）。
 * 非阻塞：CoreAPI 不可用时不打断对话。
 */
async function refreshModelRouteInfo(
  setModelName: (name: string) => void,
  setRouterTier: (tier: string | undefined) => void,
  setRoutingMode: (mode: 'dynamic' | 'static' | 'off') => void
): Promise<void> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const core = getCoreAPI();
    const lastDecision = core.getLastRouteDecision();
    const sr = core.getSmartRouter();
    if (lastDecision?.model) setModelName(lastDecision.model);
    if (lastDecision?.tier) setRouterTier(lastDecision.tier);
    let mode: 'dynamic' | 'static' | 'off' = 'static';
    if (sr?.isEnabled()) mode = 'dynamic';
    else if (sr && !sr.isEnabled()) mode = 'off';
    setRoutingMode(mode);
  } catch (err) {
    // 非阻塞
  }
}

export const ReplApp: React.FC<ReplAppProps> = ({ chatManager, onExit }) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(24);
  const [submitCount, setSubmitCount] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(
    null
  );
  const [modelName, setModelName] = useState('');
  const [routingMode, setRoutingMode] = useState<'dynamic' | 'static' | 'off'>(
    'static'
  );
  const [routerTier, setRouterTier] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const pauseResolveRef = useRef<(() => void) | null>(null);
  const isPausedRef = useRef(false);
  const currentQuestionRef = useRef<QuestionData | null>(null);
  /**
   * 本轮流内收到的工具调用（按 id 累积：`tool_start` 建条目、`tool_end` 补 status/result/error）。
   *
   * 为什么需要：`finalMessage.tool_calls` 只有 name/arguments（模型侧载荷），
   * 而**执行结果**只经 `tool_call` 完成块下发 —— 此前这类非文本 chunk 被整体跳过，
   * REPL 卡片因此只有"🔧 名称 已完成"，看不到结果。
   */
  const toolCallsRef = useRef<Map<string, ToolCallSpec>>(new Map());

  const { exit } = useApp();

  const handleEscape = useCallback(() => {
    if (streamState === 'streaming') {
      isPausedRef.current = true;
      setStreamState('paused');
    } else if (streamState === 'paused') {
      isPausedRef.current = false;
      setStreamState('streaming');
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
    }
  }, [streamState]);

  useEffect(() => {
    const updateHeight = () => {
      const h = process.stdout.rows || 24;
      setTerminalHeight(h);
    };
    updateHeight();
    process.stdout.on('resize', updateHeight);
    return () => {
      process.stdout.removeListener('resize', updateHeight);
    };
  }, []);

  // 初始化模型信息：从 modelRouter 读取初始值，再从 CoreAPIImpl 获取运行时决策
  useEffect(() => {
    (async () => {
      try {
        const { resolveModelRoute, RouteKey } = await import('@modules/ai');
        const initialModel = await resolveModelRoute(RouteKey.CHAT);
        setModelName(initialModel);

        const { getCoreAPI } =
          await import('@modules/runtime/api/CoreAPIImpl.js');
        const core = getCoreAPI();
        const lastDecision = core.getLastRouteDecision();
        const sr = core.getSmartRouter();

        let mode: 'dynamic' | 'static' | 'off' = 'static';
        if (sr?.isEnabled()) {
          mode = 'dynamic';
        } else if (sr && !sr.isEnabled()) {
          mode = 'off';
        }
        setRoutingMode(mode);

        if (lastDecision?.model) {
          setModelName(lastDecision.model);
        }
        if (lastDecision?.tier) {
          setRouterTier(lastDecision.tier);
        }
      } catch (err) {
        // 非阻塞：模型信息不可用时不中断启动
      }
    })();
  }, []);

  const handleSubmit = useCallback(
    async (content: string) => {
      setSubmitCount((prev) => prev + 1);
      logger.info('handleSubmit 开始', { content });

      const handled = await handleReplSlashInput(content, {
        pushMessage: (role, idPrefix, text) =>
          setMessages((prev) => [
            ...prev,
            {
              id: `${idPrefix}-${Date.now()}`,
              role,
              content: text,
              timestamp: Date.now(),
            },
          ]),
        clearMessages: () => setMessages([]),
        exit,
        onExit,
        getSessionId: () => chatManager.getCurrentSession()?.id,
      });
      if (handled) return;

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreamState('streaming');
      setStreamingContent('');
      setStreamStats({ startTime: Date.now(), tokenCount: 0, currentSpeed: 0 });

      const costBefore = {
        cost: getTotalCostUSD(),
        input: getTotalInputTokens(),
        output: getTotalOutputTokens(),
        cacheRead: getTotalCacheReadInputTokens(),
        cacheCreation: getTotalCacheCreationInputTokens(),
      };

      const controller = new AbortController();
      abortRef.current = controller;
      // 每轮清空：工具卡片的 status/result 只属于本轮
      toolCallsRef.current.clear();

      let tokenCount = 0;
      let accumulated = '';

      try {
        const currentSession = chatManager.getCurrentSession();
        const stream = chatManager.streamMessage(content, {
          sessionId: currentSession?.id,
        });

        let result = await stream.next();
        while (!result.done) {
          if (controller.signal.aborted) break;

          const chunkValue = result.value;

          // 处理 ChatStreamChunk 对象（如 question 类型分块）
          if (typeof chunkValue !== 'string') {
            const chunk = chunkValue as ChatStreamChunk;

            if (chunk.type === 'question' && chunk.questionData) {
              // 收到需要用户交互的问题分块
              currentQuestionRef.current = chunk.questionData;
              setCurrentQuestion(chunk.questionData);
              setStreamState('question');

              // 等待用户回答（streamMessage 内部 await 了 Promise，
              // 此处 await stream.next() 会阻塞直到 resolveInteraction 被调用）
              result = await stream.next();
              continue;
            }

            // 工具调用块：`tool_start` 建条目、`tool_end` 覆盖补 status / result / error。
            // 必须在这里接住 —— 结果只经这类非文本块下发，跳过就只剩"已完成"。
            if (chunk.type === 'tool_call' && chunk.toolCall?.id) {
              const incoming = chunk.toolCall;
              const prev = toolCallsRef.current.get(incoming.id);
              toolCallsRef.current.set(incoming.id, {
                ...prev,
                ...incoming,
                // 参数可能先到（start）后到为空（end）⇒ 不拿空对象覆盖已有参数
                arguments:
                  incoming.arguments &&
                  Object.keys(incoming.arguments).length > 0
                    ? incoming.arguments
                    : (prev?.arguments ?? {}),
              });
              result = await stream.next();
              continue;
            }

            // 其他非文本分块（如 status 等）跳过
            result = await stream.next();
            continue;
          }

          const chunk = chunkValue as string;
          accumulated += chunk;
          tokenCount++;

          setStreamingContent(accumulated);

          const elapsed = Date.now() - (streamStats?.startTime || Date.now());
          const speed =
            elapsed > 0 ? Math.round((tokenCount / elapsed) * 1000) : 0;
          setStreamStats({
            startTime: streamStats?.startTime || Date.now(),
            tokenCount,
            currentSpeed: speed,
          });

          if (isPausedRef.current) {
            await new Promise<void>((resolve) => {
              pauseResolveRef.current = resolve;
            });
          }

          result = await stream.next();
        }

        const finalMessage = result.value as {
          content?: string | object;
          tool_calls?: Array<Record<string, unknown>>;
        };
        const finalContent = finalMessage?.content || accumulated;

        if (controller.signal.aborted) {
          const partialContent =
            typeof finalContent === 'string'
              ? finalContent
              : JSON.stringify(finalContent);
          const interruptedContent = partialContent
            ? `${partialContent}\n\n[已中断]`
            : '[已中断]';
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: interruptedContent,
              timestamp: Date.now(),
              tokenInfo: {
                input: getTotalInputTokens() - costBefore.input,
                output: getTotalOutputTokens() - costBefore.output,
                total:
                  getTotalInputTokens() -
                  costBefore.input +
                  (getTotalOutputTokens() - costBefore.output),
                cacheRead:
                  getTotalCacheReadInputTokens() - costBefore.cacheRead,
                cacheCreation:
                  getTotalCacheCreationInputTokens() - costBefore.cacheCreation,
              },
              costUsd: getTotalCostUSD() - costBefore.cost,
              sessionCostUsd: getTotalCostUSD(),
            },
          ]);
          setStreamState('done');
          return;
        }

        const completedToolCalls: ToolCallInfo[] = buildCompletedToolCalls(
          finalMessage?.tool_calls,
          toolCallsRef.current
        );

        setStreamState('done');

        const contentStr =
          typeof finalContent === 'string'
            ? finalContent
            : finalContent && typeof finalContent === 'object'
              ? JSON.stringify(finalContent)
              : '';

        const hasToolCalls = completedToolCalls.length > 0;
        const displayContent =
          contentStr || (hasToolCalls ? '[已执行工具调用]' : '（无响应内容）');

        const assistantMsg: DisplayMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: displayContent,
          timestamp: Date.now(),
          toolCalls: hasToolCalls ? completedToolCalls : undefined,
          tokenInfo: {
            input: getTotalInputTokens() - costBefore.input,
            output: getTotalOutputTokens() - costBefore.output,
            total:
              getTotalInputTokens() -
              costBefore.input +
              (getTotalOutputTokens() - costBefore.output),
            cacheRead: getTotalCacheReadInputTokens() - costBefore.cacheRead,
            cacheCreation:
              getTotalCacheCreationInputTokens() - costBefore.cacheCreation,
          },
          costUsd: getTotalCostUSD() - costBefore.cost,
          sessionCostUsd: getTotalCostUSD(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        logger.error('streamMessage 失败', { error: String(err) });
        setStreamState('idle');
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `错误: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setStreamingContent('');

        // 流结束后更新模型信息（可能已有新决策记录）
        await refreshModelRouteInfo(
          setModelName,
          setRouterTier,
          setRoutingMode
        );

        currentQuestionRef.current = null;
        setCurrentQuestion(null);
        if (streamState === 'streaming' || streamState === 'question') {
          setStreamState('idle');
        }
      }
    },
    [chatManager, streamStats, exit, onExit]
  );

  /**
   * 处理用户在问题模式下的回答
   * 当 LLM 调用 ask_user_question 工具后，用户输入答案并提交时调用
   */
  const handleQuestionAnswer = useCallback(
    async (answer: string) => {
      const qData = currentQuestionRef.current;
      if (!qData || !chatManager) return;

      const trimmed = answer.trim();

      // 解析用户输入：支持数字索引（如 "1"、"1,2,3"）或直接文本
      let answers: string[];
      const indices = trimmed
        .split(/[,，\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));

      if (
        indices.length > 0 &&
        indices.every((i) => i >= 1 && i <= qData.options.length)
      ) {
        // 用户输入的是有效数字索引（1-indexed）
        answers = indices.map((i) => qData.options[i - 1].label);
      } else {
        // 回退：将输入文本作为答案
        answers = [trimmed];
      }

      logger.info('用户回答问题', { questionId: qData.questionId, answers });
      const resolved = await chatManager.resolveInteraction(
        qData.questionId,
        answers
      );

      if (resolved) {
        // 清除问题状态，恢复流式输出
        currentQuestionRef.current = null;
        setCurrentQuestion(null);
        setStreamState('streaming');
      }
    },
    [chatManager]
  );

  const conversationHeight = Math.max(6, terminalHeight - 9);
  // 9 = header(1) + floatingBar(~3) + questions(~2~4) + input(~2)

  useEffect(() => {
    const handler = () => {
      if (streamState === 'streaming' || streamState === 'question') {
        abortRef.current?.abort();
      }
    };
    process.on('SIGINT', handler);
    return () => {
      process.removeListener('SIGINT', handler);
    };
  }, [streamState]);

  return (
    <AlternateScreen>
      <Box flexDirection="column" height={terminalHeight} width="100%">
        <Header chatManager={chatManager} messageCount={messages.length} />
        <ConversationArea
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={
            streamState === 'streaming' || streamState === 'question'
          }
          streamState={streamState}
          height={conversationHeight}
        />
        <Box flexDirection="column">
          {/* 问题展示 UI：当 LLM 调用 ask_user_question 时显示 */}
          {currentQuestion && (
            <Box
              flexDirection="column"
              paddingX={1}
              paddingY={1}
              borderStyle="round"
              borderColor="yellow"
            >
              <Text bold color="yellow">
                请选择:
              </Text>
              <Text>{currentQuestion.question}</Text>
              {currentQuestion.options.map((opt, idx) => (
                <Text key={opt.label} color="cyan">
                  {idx + 1}. {opt.label}
                  {opt.description ? ` — ${opt.description}` : ''}
                </Text>
              ))}
              <Text color="gray">
                输入数字（如 1）或逗号分隔多个数字（如 1,2）后按 Enter
              </Text>
            </Box>
          )}
          {/* 浮动状态面板 */}
          <StatusFloatingBar
            streamStats={streamStats}
            streamState={streamState}
            submitCount={submitCount}
            modelName={modelName}
          />
          <InputArea
            onSubmit={currentQuestion ? handleQuestionAnswer : handleSubmit}
            disabled={
              (streamState === 'streaming' || streamState === 'paused') &&
              !currentQuestion
            }
            onEscape={handleEscape}
          />
        </Box>
      </Box>
    </AlternateScreen>
  );
};
