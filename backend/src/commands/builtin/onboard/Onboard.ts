/**
 * Onboard命令实现
 * 应用入手指引和新手向导
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'readline';
import { setConfigValue, getConfig } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 使用给定的 readline 接口提问（不创建新接口）
 */
function askQuestion(
  query: string,
  rl: import('readline').Interface
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

const WIZARD_STEPS = [
  {
    title: '欢迎使用 PY_APP',
    guide: [
      '👋 欢迎！PY_APP 是一款智能 AI 个人助手。',
      '',
      '本向导将带你快速了解核心功能并完成初始配置。',
      '',
      '按 Enter 继续，或输入 "skip" 跳过，输入 "exit" 退出向导。',
    ].join('\n'),
  },
  {
    title: '步骤 1/5 - 选择 AI 模型',
    guide: [
      '📋 选择你偏好的 AI 模型：',
      '',
      '  1. DeepSeek (默认) - 推荐，国内LLM标杆模型',
      '  2. Claude (Anthropic) - 编程能力强',
      '  3. OpenAI (GPT-4) - 通用能力强',
      '  4. 自定义 - 配置其他模型端点',
      '',
      '选定后需要配置对应的 API 密钥才能开始对话。',
      '',
      '请选择 (1/2/3/4): ',
    ].join('\n'),
  },
  {
    title: '步骤 2/5 - 配置工作目录',
    guide: [
      '📂 配置默认工作目录：',
      '',
      '  默认工作目录是你使用文件操作时的基础路径。',
      '',
      '  当前默认: 当前项目目录',
      '',
      '输入新路径（留空使用默认）: ',
    ].join('\n'),
  },
  {
    title: '步骤 3/5 - 启用功能',
    guide: [
      '⚙️  选择要启用的功能：',
      '',
      '  [y/n] 自动补全 - Enter 启用',
      '  [y/n] Git 集成',
      '  [y/n] 多 Agent 协作',
      '  [y/n] 通道消息通知',
      '',
      '输入 y 启用，n 禁用，留空默认启用: ',
    ].join('\n'),
  },
  {
    title: '步骤 4/5 - 安全设置',
    guide: [
      '🔒 安全偏好设置：',
      '',
      '  1. 宽松模式 - 自动确认大多数操作',
      '  2. 标准模式 - 敏感操作需确认',
      '  3. 严格模式 - 所有操作需确认',
      '',
      '请选择 (1/2/3)，默认 2: ',
    ].join('\n'),
  },
  {
    title: '步骤 5/5 - 完成配置',
    guide: [
      '🎉 恭喜！初始配置已完成。',
      '',
      '快速入门：',
      '  /config list            - 查看当前配置',
      '  /config get ai.provider - 确认 AI 提供商配置',
      '  /help                   - 查看所有命令',
      '  /docs                   - 查看文档',
      '  /chat                   - 开始对话',
      '  /skill                  - 管理技能',
      '',
      '配置验证:',
      '  输入 /config get ai 检查 AI 配置是否完整。',
      '  如果 API 密钥未配置，使用 /config set ai.deepseek.apiKey sk-你的密钥 设置。',
      '',
      '祝你使用愉快！',
      '',
      '输入 "restart" 重新开始向导，或 "exit" 退出。',
    ].join('\n'),
  },
];

const onboardCommand = {
  /**
   * 执行 onboard 命令
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const cleanArgs = args.trim().toLowerCase();

    if (cleanArgs === 'help' || cleanArgs === '--help' || cleanArgs === '-h') {
      return this.showHelp();
    }

    if (cleanArgs === 'status') {
      return this.showStatus();
    }

    if (cleanArgs === 'reset') {
      return this.resetWizard();
    }

    if (cleanArgs === 'skip') {
      return this.skipWizard();
    }

    if (cleanArgs === 'quick' || cleanArgs === '--quick') {
      return this.quickStart();
    }

    const results = await runOnboard(context.replReadline);
    return { success: true, type: 'text', message: results.join('\n') };
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Onboard 入手指引命令',
      '',
      '用法:',
      '  /onboard                   - 启动入手指引向导',
      '  /onboard quick             - 快速入门指引',
      '  /onboard status            - 查看配置状态',
      '  /onboard reset             - 重置向导状态',
      '  /onboard skip              - 跳过向导',
      '',
      '向导导航:',
      '  在向导中输入 Enter 继续，skip 跳过当前步骤，exit 退出向导。',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 显示配置状态
   */
  showStatus(): CommandResult {
    let aiProvider = '未配置';
    let aiKeyStatus = '未配置';
    try {
      const config = getConfig();
      const provider = (config as Record<string, unknown>)?.ai
        ? ((config as Record<string, unknown>).ai as Record<string, unknown>)
            .provider
        : undefined;
      if (provider) {
        aiProvider = String(provider);
        const providerConfig = (config as Record<string, unknown>).ai
          ? ((config as Record<string, unknown>).ai as Record<string, unknown>)[
              provider as string
            ]
          : undefined;
        if (
          providerConfig &&
          (providerConfig as Record<string, unknown>).apiKey
        ) {
          aiKeyStatus = '✅ 已配置';
        } else {
          aiKeyStatus = '⚠️ 未配置（需设置 API 密钥）';
        }
      }
    } catch {
      aiKeyStatus = '未知';
    }

    const lines = [
      '📊 配置状态',
      '',
      `  AI 提供商:   ${aiProvider}`,
      `  API 密钥:    ${aiKeyStatus}`,
      '  工作目录:    当前项目目录',
      '  安全模式:    标准模式',
      '',
      '配置指南:',
      `  ${aiKeyStatus.includes('未配置') ? '  /config set ai.deepseek.apiKey sk-你的密钥  ← 设置 API 密钥' : '  ✅ API 密钥已就绪'}`,
      '  /onboard              - 启动完整入手指引',
      '  /config list          - 查看所有配置',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 重置向导
   */
  resetWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message: '🔄 向导状态已重置。\n\n使用 /onboard 重新开始入手指引。',
    };
  },

  /**
   * 跳过向导
   */
  skipWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message:
        '⏭️  已跳过入手指引。\n\n你可以随时使用 /onboard 重新开启。\n使用 /help 查看所有可用命令。',
    };
  },

  /**
   * 快速入门
   */
  quickStart(): CommandResult {
    const guide = [
      '🚀 PY_APP 快速入门',
      '',
      '1. 首次配置 - 设置 AI 模型',
      '   /config set ai.provider deepseek           ← 选择 AI 提供商',
      '   /config set ai.deepseek.apiKey sk-你的密钥   ← 设置 API 密钥',
      '   /config get ai                              ← 验证配置',
      '',
      '2. 核心命令',
      '   /chat         开始与 AI 对话',
      '   /read         读取文件',
      '   /write        写入文件',
      '   /search       搜索代码',
      '   /list         浏览目录',
      '',
      '3. 管理功能',
      '   /config       配置应用',
      '   /skill list   查看可用技能',
      '   /plugins      管理插件',
      '   /docs         浏览文档',
      '',
      '4. 实用技巧',
      '   • 输入 /help <命令> 查看特定命令帮助',
      '   • 使用 Tab 键自动补全命令',
      '   • 使用 ↑/↓ 键浏览命令历史',
      '   • 输入 /docs search <关键词> 搜索文档',
      '',
      '5. 进阶功能',
      '   • 多 Agent 协作: /agent start',
      '   • 通道管理: /channel list',
      '   • 性能监控: /performance report',
      '',
      '💡 首次使用请先完成第 1 步的 AI 模型配置，然后重启应用开始对话。',
    ].join('\n');

    return { success: true, type: 'text', message: guide };
  },

  /**
   * 启动向导
   */
  startWizard(): CommandResult {
    const lines = [
      '📋 PY_APP 入手指引',
      '',
      '本向导将引导你完成 PY_APP 的初始配置。',
      '',
      '在交互模式下输入 /onboard 将启动交互式向导，',
      '在当前模式下将显示配置步骤概览。',
      '',
      '配置步骤:',
      ...WIZARD_STEPS.map((s, i) => `  ${i + 1}. ${s.title}`),
      '',
      '常用命令:',
      '  /onboard status  - 查看当前配置状态',
      '  /onboard quick   - 快速入门指引',
      '  /onboard reset   - 重置所有配置',
      '',
      '注意: 请进入交互模式（/chat）后执行 /onboard 启动完整的交互式向导。',
    ].join('\n');

    return { success: true, type: 'text', message: lines };
  },
};

export async function runOnboard(
  replRl?: import('readline').Interface
): Promise<string[]> {
  const results: string[] = [];
  const cwd = process.cwd();

  if (replRl) {
    replRl.pause();
  }

  const tempRl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    results.push('═══════════════════════════════════════════');
    results.push('          PY_APP 引导设置');
    results.push('═══════════════════════════════════════════');
    results.push('');

    results.push('Step 1: 配置 AI 模型');
    results.push(
      '  PY_APP 使用 AI 模型进行对话，需要选择提供商并设置 API 密钥。'
    );
    results.push('');

    const providerChoice = await askQuestion(
      '  选择 AI 提供商 (1:DeepSeek 2:Claude 3:OpenAI 4:自定义, 默认 1): ',
      tempRl
    );

    let provider = 'deepseek';
    let providerLabel = 'DeepSeek';
    let configKey = 'ai.deepseek.apiKey';

    switch (providerChoice) {
      case '2':
        provider = 'anthropic';
        providerLabel = 'Claude (Anthropic)';
        configKey = 'ai.anthropic.apiKey';
        break;
      case '3':
        provider = 'openai';
        providerLabel = 'OpenAI (GPT)';
        configKey = 'ai.openai.apiKey';
        break;
      case '4': {
        provider = 'custom';
        const customName = await askQuestion(
          '  请输入自定义提供商名称: ',
          tempRl
        );
        providerLabel = customName || '自定义';
        configKey = 'ai.custom.apiKey';
        break;
      }
      default:
        provider = 'deepseek';
        providerLabel = 'DeepSeek';
        configKey = 'ai.deepseek.apiKey';
        break;
    }

    results.push(`  已选择: ${providerLabel}`);
    results.push('');

    const apiKey = await askQuestion(
      `  请输入 ${providerLabel} 的 API 密钥（留空可跳过）:\n  > `,
      tempRl
    );

    try {
      setConfigValue('ai.provider', provider);
      results.push('  ✅ AI 提供商已保存');

      if (apiKey) {
        setConfigValue(configKey, apiKey);
        results.push('  ✅ API 密钥已保存');
      } else {
        results.push(`  ⚠️ 未设置 API 密钥`);
        results.push(
          `     后续可在命令行输入: /config set ${configKey} sk-你的密钥`
        );
      }
    } catch (e) {
      results.push(
        `  ❌ 配置保存失败: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    results.push('');

    results.push('Step 2: 初始化目录结构...');
    const dirs = ['config', 'configs', 'data', 'logs', 'plugins', 'backups'];
    for (const dir of dirs) {
      const dirPath = join(cwd, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        results.push(`  创建目录: ${dir}`);
      }
    }
    results.push('  ✅ 目录结构就绪');

    results.push('');
    results.push('Step 3: 初始化配置文件...');
    const initFiles = [
      {
        path: join(cwd, 'config.json'),
        content: JSON.stringify({ name: 'PY_APP', version: '1.0.0' }, null, 2),
        label: 'config.json',
      },
      {
        path: join(cwd, 'config', 'governance.json'),
        content: JSON.stringify(
          { allowAllModels: false, maxTokensPerRequest: 200000 },
          null,
          2
        ),
        label: 'config/governance.json',
      },
      {
        path: join(cwd, 'configs', 'permissions.yaml'),
        content:
          '# PY_APP 权限配置\nroles:\n  admin:\n    allow: ["*"]\n  user:\n    allow: ["read", "write", "search"]\n',
        label: 'configs/permissions.yaml',
      },
    ];

    for (const file of initFiles) {
      if (!existsSync(file.path)) {
        writeFileSync(file.path, file.content);
        results.push(`  创建: ${file.label}`);
      }
    }
    results.push('  ✅ 配置文件就绪');

    results.push('');
    results.push('Step 4: 检测运行环境...');
    results.push(`  运行时: Node.js ${process.version}`);
    results.push(`  平台: ${process.platform} (${process.arch})`);
    results.push(
      `  包管理器: ${existsSync(join(cwd, 'bun.lock')) ? 'Bun' : existsSync(join(cwd, 'package-lock.json')) ? 'npm' : '未知'}`
    );
    const isDocker =
      existsSync('/.dockerenv') || existsSync(join(cwd, 'Dockerfile'));
    results.push(`  Docker: ${isDocker ? '是' : '否'}`);
    results.push('  ✅ 环境检测完成');

    results.push('');
    results.push('Step 5: 配置检查...');
    try {
      const currentConfig = getConfig() as Record<string, unknown>;
      const aiConfig = currentConfig?.ai as Record<string, unknown> | undefined;
      const savedProvider = aiConfig?.provider as string | undefined;
      const savedKey = savedProvider
        ? (aiConfig?.[savedProvider] as Record<string, unknown> | undefined)
            ?.apiKey
        : undefined;
      if (savedProvider && savedKey) {
        results.push(`  ✅ AI 配置完整: ${savedProvider}`);
      } else if (savedProvider) {
        results.push(
          `  ⚠️ 需要设置 API 密钥: /config set ai.${savedProvider}.apiKey sk-你的密钥`
        );
      } else {
        results.push('  ⚠️ AI 配置不完整，请检查');
      }
    } catch {
      results.push('  ⚠️ 配置检查失败');
    }
    results.push('  ✅ 配置检查完成');

    results.push('');
    results.push('═══════════════════════════════════════════');
    results.push('引导设置完成！');
    results.push('');
    results.push('下一步:');
    if (!apiKey) {
      results.push('  1. 设置 API 密钥（任选其一）:');
      results.push(`     • /config set ${configKey} sk-你的密钥`);
      results.push(
        '     • 编辑 backend/.env 文件，填入 DEEPSEEK_API_KEY=sk-你的密钥'
      );
      results.push('  2. 重启应用，开始对话');
    } else {
      results.push('  1. 重启应用，开始对话');
      results.push('  2. /config list 查看完整配置');
      results.push('  3. /help 查看所有命令');
    }
    return results;
  } finally {
    tempRl.close();
    if (replRl) {
      replRl.resume();
    }
  }
}

export default onboardCommand;
