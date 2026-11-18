/**
 * Ink REPL 的**硬编码斜杠命令**处理（2026-11-17，T3 复杂度清理）。
 *
 * 来源：从 `ReplApp.tsx` 的 `handleSubmit` 原样搬出（`exit`/`quit`、`/clear`、`/help`、
 * `/ink`、`/router*` 及兜底 `/xxx` 派发），仅把 React 状态写入改为注入的 `ReplSlashUi`。
 *
 * 为什么独立成模块：ink 渲染层在本仓无测试夹具（无伪终端 / 无 ink 测试库），
 * 把唯一有分支的"识别 + 文案整形"抽成不依赖 ink 的模块后可直接单测（同 `commandDispatch`
 * 的先例，见 `app/tests/ink/replSlashRoutes.test.ts`）。
 *
 * 语义契约：返回 `true` 表示该输入已被斜杠分支消费（调用方**不得**再送进模型）；
 * `false` 表示普通对话输入。分支顺序与搬出前一致（`/router status` 在 `/router on|off`
 * 之前判定，`/router` 精确匹配在带参分支之前）。
 */
import { dispatchSlashCommand } from './commandDispatch';

/** REPL 侧可注入的 UI 副作用（组件内即 `setMessages` 等） */
export interface ReplSlashUi {
  /** 追加一条消息；`idPrefix` 决定消息 id 前缀（`user` / `help` / `router-status` …） */
  pushMessage(role: 'user' | 'system', idPrefix: string, content: string): void;
  /** 清空对话（`/clear`） */
  clearMessages(): void;
  /** Ink 的退出句柄（`exit`/`quit`） */
  exit?: () => void;
  /** 宿主提供的退出回调（`exit`/`quit`） */
  onExit(): void;
  /** 当前会话 id（透传给命令执行器） */
  getSessionId(): string | undefined;
}

export async function handleReplSlashInput(
  content: string,
  ui: ReplSlashUi
): Promise<boolean> {
  if (content === 'exit' || content === 'quit') {
    ui.exit?.();
    ui.onExit();
    return true;
  }

  if (content === '/clear') {
    ui.clearMessages();
    return true;
  }

  if (content === '/help') {
    ui.pushMessage('user', 'user', content);
    // ①（2026-10-16）：命令清单**让位给注册表**（`helpCommand` 读 `commandRegistry.getVisible()`）
    // —— 原先此处硬编码 5 条，注册表里的 131 条命令在 TUI 里既不可见也不可达。
    // 仅追加 ink TUI 独有的按键说明（注册表不掌握键盘映射）。
    const outcome = await dispatchSlashCommand('/help');
    ui.pushMessage(
      'system',
      'help',
      [
        outcome.text,
        '',
        '快捷键（仅 Ink TUI）:',
        '  ↑↓            - 浏览输入历史',
        '  Tab           - 命令补全',
        '  PageUp/Down   - 翻页浏览对话',
        '  Ctrl+Home/End - 跳到对话首/尾',
      ].join('\n')
    );
    return true;
  }

  if (content === '/ink') {
    ui.pushMessage('user', 'user', content);
    ui.pushMessage(
      'system',
      'ink-info',
      '当前运行: Liri Ink TUI 模式 (React-for-CLI) — 流式输出、工具调用可视化、Markdown 渲染。'
    );
    return true;
  }

  if (content === '/router') {
    ui.pushMessage('user', 'user', content);
    ui.pushMessage(
      'system',
      'router-help',
      [
        '智能路由 SmartRouter 命令:',
        '  /router         - 显示此帮助',
        '  /router status  - 查看当前路由状态与最近决策',
        '  /router on      - 启用智能路由（运行时即时生效）',
        '  /router off     - 关闭智能路由（回退静态路由）',
        '  /router config  - 查看完整路由配置',
      ].join('\n')
    );
    return true;
  }

  if (content === '/router status') {
    ui.pushMessage('user', 'user', content);
    // 动态加载，避免循环依赖
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();
      const lastDecision = core.getLastRouteDecision();
      const routerConfig = router?.getConfig();
      ui.pushMessage(
        'system',
        'router-status',
        [
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
        ].join('\n')
      );
    } catch (err) {
      ui.pushMessage(
        'system',
        'router-status',
        '❌ 无法获取路由状态（SmartRouter 未初始化或 CoreAPI 不可用）'
      );
    }
    return true;
  }

  if (content === '/router on' || content === '/router off') {
    const enable = content === '/router on';
    ui.pushMessage('user', 'user', content);
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const { configManager } = await import('@openliri/infra/config');
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
        ui.pushMessage(
          'system',
          'router-toggle',
          `✅ SmartRouter 已${enable ? '启用' : '关闭'}（运行时即时生效，配置已持久化）`
        );
      } else {
        ui.pushMessage(
          'system',
          'router-toggle',
          '❌ SmartRouter 未初始化，无法切换'
        );
      }
    } catch (err) {
      ui.pushMessage(
        'system',
        'router-toggle',
        '❌ 操作失败（CoreAPI 或 ConfigManager 不可用）'
      );
    }
    return true;
  }

  if (content === '/router config') {
    ui.pushMessage('user', 'user', content);
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();
      const routerConfig = router?.getConfig();
      ui.pushMessage(
        'system',
        'router-config',
        routerConfig
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
          : '❌ SmartRouter 未初始化，无法读取配置'
      );
    } catch (err) {
      ui.pushMessage('system', 'router-config', '❌ 无法读取路由配置');
    }
    return true;
  }

  // 方案①（2026-10-16）：内置斜杠命令统一派发。
  // 此前本文件只处理上面硬编码的 /help、/clear、/ink、/onboard、/router* 五类，
  // 其余 `/xxx`（如 /budget、/git、/commit）会落到底部 `chatManager.streamMessage`
  // 当**普通消息送进模型**（真机实测：模型自述「该斜杠命令由应用层处理…当前消息落到了
  // 我这里」）⇒ 此处交给与 Terminal 页 / 非流式 HTTP 同一个 `commandExecutor`（CS01 复用）。
  if (content.startsWith('/')) {
    ui.pushMessage('user', 'user', content);
    const outcome = await dispatchSlashCommand(content, ui.getSessionId());
    // role 用 'system'：命令输出是**纯文本语义**（同本文件既有命令分支），
    // 过 MarkdownRenderer 会被其中的 `#` / `*` 误当标题与列表项。
    ui.pushMessage('system', 'command', outcome.text);
    return true;
  }

  return false;
}
