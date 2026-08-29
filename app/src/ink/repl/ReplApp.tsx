import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, AlternateScreen, useApp } from '../../ink';
import { ConversationArea } from './ConversationArea';
import { InputArea } from './InputArea';
import { StatusFloatingBar } from './StatusFloatingBar';
import { Header } from './Header';
import { getLogger } from '@modules/monitoring';
import {
  getTotalCostUSD,
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCacheReadInputTokens,
  getTotalCacheCreationInputTokens,
} from '@modules/cost';
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
} from '@modules/runtime/api/CoreAPI';

const logger = getLogger('ink:repl');

interface ReplAppProps {
  chatManager: ChatManager;
  onExit: () => void;
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
        const { resolveModelRoute, RouteKey } =
          await import('@modules/ai/router/resolveModelRoute.js');
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

      if (content === 'exit' || content === 'quit') {
        exit?.();
        onExit();
        return;
      }

      if (content === '/clear') {
        setMessages([]);
        return;
      }

      if (content === '/help') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
          {
            id: `help-${Date.now()}`,
            role: 'system',
            content: [
              '可用命令:',
              '  /help       - 显示帮助',
              '  /clear      - 清空对话',
              '  /onboard    - 重新配置 AI 设置',
              '  /router     - 智能路由管理（status/on/off/config）',
              '  /ink        - 显示 Ink 模式信息',
              '  exit        - 退出',
              '',
              '快捷键:',
              '  ↑↓       - 浏览输入历史',
              '  Tab      - 命令补全',
              '  PageUp/Down - 翻页浏览对话',
              '  Ctrl+Home/End - 跳到对话首/尾',
            ].join('\n'),
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (content === '/ink') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
          {
            id: `ink-info-${Date.now()}`,
            role: 'system',
            content:
              '当前运行: Liri Ink TUI 模式 (React-for-CLI) — 流式输出、工具调用可视化、Markdown 渲染。',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (content === '/router') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
          {
            id: `router-help-${Date.now()}`,
            role: 'system',
            content: [
              '智能路由 SmartRouter 命令:',
              '  /router         - 显示此帮助',
              '  /router status  - 查看当前路由状态与最近决策',
              '  /router on      - 启用智能路由（运行时即时生效）',
              '  /router off     - 关闭智能路由（回退静态路由）',
              '  /router config  - 查看完整路由配置',
            ].join('\n'),
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (content === '/router status') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
        ]);
        // 动态加载，避免循环依赖
        try {
          const { getCoreAPI } =
            await import('@modules/runtime/api/CoreAPIImpl');
          const core = getCoreAPI();
          const router = core.getSmartRouter();
          const lastDecision = core.getLastRouteDecision();
          const routerConfig = router?.getConfig();
          setMessages((prev) => [
            ...prev,
            {
              id: `router-status-${Date.now()}`,
              role: 'system',
              content: [
                '=== SmartRouter 状态 ===',
                `  启用: ${routerConfig?.enabled ? '✅ 是' : '❌ 否（使用静态路由）'}`,
                `  实例活跃: ${router !== null ? '✅' : '❌'}`,
                `  默认等级: ${routerConfig?.defaultTier || 'medium'}`,
                `  会话黏性: ${routerConfig?.sessionSticky ? '✅ 开启' : '❌ 关闭'}`,
                '',
                '最近路由决策:',
                lastDecision
                  ? `  等级: ${lastDecision.tier} | 模型: ${lastDecision.model} | Provider: ${lastDecision.provider}`
                  : '  （暂无记录）',
              ].join('\n'),
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              id: `router-status-${Date.now()}`,
              role: 'system',
              content:
                '❌ 无法获取路由状态（SmartRouter 未初始化或 CoreAPI 不可用）',
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }

      if (content === '/router on' || content === '/router off') {
        const enable = content === '/router on';
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
        ]);
        try {
          const { getCoreAPI } =
            await import('@modules/runtime/api/CoreAPIImpl');
          const { configManager } =
            await import('@modules/config/ConfigManager');
          const core = getCoreAPI();
          const router = core.getSmartRouter();
          if (router) {
            router.updateConfig({ enabled: enable } as any);
            // 同时持久化到 config.json
            const current =
              configManager.getConfigValue<Record<string, unknown>>(
                'models.router'
              ) || {};
            configManager.setConfigValue('models.router', {
              ...current,
              enabled: enable,
            });
            setMessages((prev) => [
              ...prev,
              {
                id: `router-toggle-${Date.now()}`,
                role: 'system',
                content: `✅ SmartRouter 已${enable ? '启用' : '关闭'}（运行时即时生效，配置已持久化）`,
                timestamp: Date.now(),
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `router-toggle-${Date.now()}`,
                role: 'system',
                content: '❌ SmartRouter 未初始化，无法切换',
                timestamp: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              id: `router-toggle-${Date.now()}`,
              role: 'system',
              content: '❌ 操作失败（CoreAPI 或 ConfigManager 不可用）',
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }

      if (content === '/router config') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
        ]);
        try {
          const { getCoreAPI } =
            await import('@modules/runtime/api/CoreAPIImpl');
          const core = getCoreAPI();
          const router = core.getSmartRouter();
          const routerConfig = router?.getConfig();
          setMessages((prev) => [
            ...prev,
            {
              id: `router-config-${Date.now()}`,
              role: 'system',
              content: routerConfig
                ? [
                    '=== SmartRouter 配置 ===',
                    `  启用: ${routerConfig.enabled}`,
                    `  默认等级: ${routerConfig.defaultTier}`,
                    `  会话黏性: ${routerConfig.sessionSticky ?? true}`,
                    '',
                    'Tier 映射:',
                    ...Object.entries(routerConfig.tiers || {}).map(
                      ([tier, cfg]) =>
                        `  ${tier}: ${cfg?.model} (${cfg?.providerHint || 'auto'})`
                    ),
                    '',
                    'Judge 配置:',
                    routerConfig.judge
                      ? `  Provider: ${routerConfig.judge.provider} | 模型: ${routerConfig.judge.model} | 超时: ${routerConfig.judge.timeoutMs}ms`
                      : '  （未配置 Judge，回退默认等级）',
                    '',
                    '回退链:',
                    (routerConfig.fallback?.length ?? 0) > 0
                      ? routerConfig
                          .fallback!.map(
                            (f, i) => `  ${i + 1}. ${f.provider}/${f.model}`
                          )
                          .join('\n')
                      : '  （无配置）',
                    '',
                    '零用量重试:',
                    routerConfig.zeroUsageRetry?.enabled
                      ? `  启用（最多 ${routerConfig.zeroUsageRetry.maxAttempts} 次）`
                      : '  关闭',
                    '瞬态重试:',
                    routerConfig.transientRetry?.enabled
                      ? `  启用（最多 ${routerConfig.transientRetry.maxAttempts} 次，延迟 ${routerConfig.transientRetry.baseDelayMs}~${routerConfig.transientRetry.maxDelayMs}ms）`
                      : '  关闭',
                  ].join('\n')
                : '❌ SmartRouter 未初始化，无法读取配置',
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              id: `router-config-${Date.now()}`,
              role: 'system',
              content: '❌ 无法读取路由配置',
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }

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

            // 其他非文本分块（如 tool_call, status 等）跳过
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

        const completedToolCalls: ToolCallInfo[] =
          finalMessage?.tool_calls?.map((tc: Record<string, unknown>) => {
            const fn = (tc.function || {}) as Record<string, unknown>;
            return {
              id: (tc.id as string) || '',
              name: (fn.name as string) || (tc.name as string) || 'unknown',
              arguments: (fn.arguments
                ? typeof fn.arguments === 'string'
                  ? JSON.parse(fn.arguments as string)
                  : fn.arguments
                : tc.arguments || {}) as Record<string, unknown>,
            };
          }) || [];

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
        try {
          const { getCoreAPI } =
            await import('@modules/runtime/api/CoreAPIImpl.js');
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
