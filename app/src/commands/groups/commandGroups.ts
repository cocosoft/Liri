/**
 * 命令分组表（P3，2026-10-30）—— 「顶层收敛 + 旧名保留」的**唯一事实源**。
 *
 * 背景：`dev_docs/20261030/Liri-工具与命令治理方案-20261030.md` §5 要求斜杠命令
 * 「功能一个不少，顶层收敛 + 子命令 + 旧名别名（保留 2 个版本）」。实测注册面是 **121**
 * 个内置命令（+ 运行期技能命令），其中 14 个是与工具同名的"影子命令"。
 *
 * 落地口径（用户 2026-10-30 裁定）：
 * - **务实 27 个顶层** = 9 个分组父命令（`help` / `git` / `session` / `usage` / `config` /
 *   `setup` / `diagnose` / `work` / `media`）+ 18 个独立命令（`KEEP_TOP_LEVEL`，含 3 个
 *   不能分组的 prompt 型：`branch` / `diff` / `commit-push-pr`）；
 * - 其余命令**照常注册、照常可执行**，只是 `isHidden: true`（不出现在 `/help` 与补全里）；
 * - 每个被隐藏的命令都必须能经「`/分组 <子命令>`」到达（本表 `subcommands`），
 *   或属于 `HIDDEN_ONLY`（工具影子命令等，有显式理由）。
 *
 * ⚠️ 与"别名"的关系（如实说明）：本仓的执行链路（`CommandManager.executeCommand`）
 * 以**命令名**解析；把旧顶层名保留为 alias 与保留为"隐藏命令"对用户**等价**（`/budget status`
 * 仍然可用）。选择后者是为了不复制一份别名表（历史上 `moduleEntries` 已手抄过一遍别名）。
 *
 * 本模块**纯数据 + 纯函数**：可被 loader / manager / help / 测试共同引用，零副作用。
 */

/** 一个分组：父命令名 → 子命令名 → 目标命令名（目标必须是已注册命令） */
export interface CommandGroupSpec {
  /** `/help` 上的一句话说明 */
  summary: string;
  subcommands: Readonly<Record<string, string>>;
}

/**
 * 分组表（父命令 → 子命令 → 原命令）。
 *
 * 约束（由 `tests/commands/commandGroups.test.ts` 锁死）：
 * - 目标必须是**已注册命令名**，且**不得**是任何分组父命令（防递归）；
 * - 同一个父命令内子命令名不得重复；
 * - **prompt 型**命令（`review` 之外的 `security-review` / `commit-push-pr` 等）不进本表 ——
 *   它们依赖 `expandPromptCommand()` 在**执行前**按名字注入，走分组会退化成"打印提示词"。
 * - 父命令自身的子命令（如 `/git status`）**不在此表**（由父命令实现处理），避免语义被改写。
 */
export const COMMAND_GROUPS: Readonly<Record<string, CommandGroupSpec>> = {
  // `help` 自身支持 search/topic；这里只补它没有的 `tutorial`
  help: {
    summary: '帮助（自身还支持 search / topic）',
    subcommands: {
      tutorial: 'tutorial',
    },
  },
  git: {
    summary:
      'Git 与代码评审（自身还支持 status/branch/log/diff/stash/tag/info）',
    subcommands: {
      commit: 'commit',
      review: 'review',
      comments: 'pr-comments',
    },
  },
  session: {
    summary:
      '会话与上下文（自身还支持 list/create/switch/delete/info/current）',
    subcommands: {
      resume: 'resume',
      rename: 'rename',
      rewind: 'rewind',
      checkpoint: 'checkpoint',
      compact: 'compact',
      context: 'context',
      history: 'history',
      export: 'export',
      share: 'share',
    },
  },
  usage: {
    summary: '用量与成本',
    subcommands: {
      cost: 'cost',
      tokens: 'tokens',
      budget: 'budget',
      pricing: 'pricing',
      activity: 'activity',
      insights: 'insights',
      extra: 'extra-usage',
      ratelimit: 'rate-limit-options',
      // 2026-10-31 接线（此前"定义了但从未注册"）
      balance: 'balance',
      stats: 'usagestats',
    },
  },
  config: {
    summary: '配置与外观',
    subcommands: {
      env: 'env',
      theme: 'theme',
      color: 'color',
      statusline: 'statusline',
      keybindings: 'keybindings',
      keyboard: 'keyboard',
      terminal: 'terminalSetup',
      privacy: 'privacy-settings',
      vim: 'vim',
      fast: 'fast',
      effort: 'effort',
      sandbox: 'sandbox-toggle',
      plugins: 'reload-plugins',
      permissions: 'permissions',
      'output-style': 'output-style',
      'remote-env': 'remote-env',
    },
  },
  setup: {
    summary: '安装、登录与扩展',
    subcommands: {
      onboard: 'onboard',
      init: 'init',
      login: 'login',
      logout: 'logout',
      upgrade: 'upgrade',
      'github-app': 'install-github-app',
      'slack-app': 'install-slack-app',
      mcp: 'mcp',
      plugins: 'plugins',
      'plugin-settings': 'plugin-settings',
      skill: 'skill',
      tool: 'tool',
      'add-dir': 'add-dir',
      bridge: 'bridge',
      ide: 'ide',
      // 2026-10-31 接线（此前"定义了但从未注册"）
      provider: 'provider',
      backup: 'backup',
      migrate: 'migrate',
    },
  },
  diagnose: {
    summary: '诊断与运行态',
    subcommands: {
      doctor: 'doctor',
      debug: 'debug',
      heapdump: 'heapdump',
      modules: 'modules',
      hooks: 'hooks',
      cache: 'cache',
      trace: 'trace',
      version: 'version',
      restart: 'restart',
      health: 'health',
      gateway: 'gateway',
      'release-notes': 'release-notes',
      // 2026-10-31 接线（此前"定义了但从未注册"）
      logs: 'logs',
      stats: 'stats',
    },
  },
  work: {
    summary: '计划、任务与代理',
    subcommands: {
      plan: 'plan',
      goal: 'goal',
      tasks: 'tasks',
      cron: 'cron',
      workspace: 'workspace',
      parallel: 'parallel',
      subagent: 'subagent',
      advisor: 'advisor',
      btw: 'btw',
      brief: 'brief',
      feedback: 'feedback',
      complete: 'complete',
    },
  },
  media: {
    summary: '语音、媒体与宿主集成',
    subcommands: {
      voice: 'voice',
      stickers: 'stickers',
      demo: 'demo',
      thinkback: 'thinkback',
      'thinkback-play': 'thinkback-play',
      chrome: 'chrome',
      mobile: 'mobile',
      desktop: 'desktop',
      search: 'search',
    },
  },
};

/**
 * **独立保留**的顶层命令（2026-10-30 用户裁定：务实收敛）。
 *
 * = 9 个分组父命令（含 `help`）+ 下列 18 个（含 `help` 自身去重后共 27 个顶层面）。
 * 其中 `branch` / `diff` / `commit-push-pr` 是 **prompt 型**命令（依赖
 * `expandPromptCommand()` 按名字注入）⇒ 不能进分组，只能保留为顶层。
 */
export const KEEP_TOP_LEVEL: readonly string[] = [
  'help',
  'exit',
  'clear',
  'chat',
  'status',
  'files',
  'knowledge',
  'memory',
  'copy',
  'tag',
  'security',
  'security-review',
  'docs',
  'timer',
  'passes',
  'model',
  // prompt 型（不能进分组；见上）
  'branch',
  'diff',
  'commit-push-pr',
];

/**
 * **隐藏且不进任何分组**的命令（有显式理由；仍可执行）。
 *
 * - 14 个工具影子命令（`bash` / `edit` / `write` / `glob` / `grep` / `convert` /
 *   `subagent-run` / `agent-instance` / `fetch` / `websearch` / `todo` / `task` / `lsp` /
 *   `notebook`）：它们与**工具**同名（模型侧走工具），斜杠形态只是历史残留；
 *   其中多数是 prompt 型（`getPromptForCommand`），不能进分组（见 `COMMAND_GROUPS` 注释）。
 */
export const HIDDEN_ONLY: Readonly<Record<string, string>> = {
  bash: '工具影子命令（模型侧走 bash 工具）',
  edit: '工具影子命令（模型侧走 file_edit 工具）',
  write: '工具影子命令（模型侧走 file_write 工具）',
  glob: '工具影子命令（模型侧走 glob 工具）',
  grep: '工具影子命令（模型侧走 grep 工具）',
  convert: '工具影子命令（模型侧走 file_convert 工具）',
  fetch: '工具影子命令（模型侧走 web_fetch 工具）',
  websearch: '工具影子命令（模型侧走 web_search 工具）',
  todo: '工具影子命令（模型侧走 todo_write 工具）',
  task: '工具影子命令（模型侧走 task_list 工具）',
  lsp: '工具影子命令（模型侧走 lsp 工具）',
  notebook: '工具影子命令（模型侧走 notebook 工具）',
  'subagent-run': '工具影子命令（模型侧走 agent 工具）',
  'agent-instance': '工具影子命令（模型侧走 agent 工具）',
  // 2026-10-31：与 `/gateway` **同源重复**（同一 `channelRegistry`；
  // `channel list|status|connect|disconnect` ≡ `gateway list|status|start|stop`）
  // ⇒ 只注册保证旧脚本可用，**不进分组**（避免第二处入口）。
  channel:
    '与 /gateway 同源重复（同一 channelRegistry，动作等价）⇒ 不设第二处入口；后续版本评估删除',
};

/** 全部可见顶层命令（分组父命令 + 独立保留） */
export function getVisibleTopLevelNames(): Set<string> {
  return new Set([...Object.keys(COMMAND_GROUPS), ...KEEP_TOP_LEVEL]);
}

/** 该命令是否应出现在 `/help` 与补全里 */
export function isVisibleTopLevel(name: string): boolean {
  return name in COMMAND_GROUPS || KEEP_TOP_LEVEL.includes(name);
}

/**
 * 分组改写：`(父命令, 参数)` → `(目标命令, 剩余参数)`；不适用 ⇒ `undefined`。
 *
 * 只认**首 token**；父命令自身的子命令（如 `/git status`）不在表内 ⇒ 原样返回 `undefined`
 * （由父命令自己的实现处理，语义不变）。
 */
export function resolveGroupDelegation(
  parentName: string,
  args: string
): { name: string; args: string } | undefined {
  const group = COMMAND_GROUPS[parentName];
  if (!group) return undefined;
  const trimmed = (args ?? '').trim();
  if (!trimmed) return undefined;
  const [sub, ...rest] = trimmed.split(/\s+/);
  const target = sub ? group.subcommands[sub] : undefined;
  if (!target) return undefined;
  return { name: target, args: rest.join(' ') };
}
