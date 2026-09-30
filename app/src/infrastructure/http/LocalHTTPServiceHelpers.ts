/**
 * LocalHTTPServiceHelpers.ts — HTTP 服务辅助方法（从 LocalHTTPService 提取）
 *
 * 包含通道注册表、动态注册、知识库种子、编译调度等辅助功能。
 */

import http from 'http';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { setNotifyFileChangedHandler } from './handlers/handler-utils';

const logger = getLogger('infrastructure:http:localHTTPServiceHelpers');

// 通道动态注册元信息统一取自 `channels/ChannelCatalog.ts`（单一事实源）
// 2026-09-30 · 台账 D-134：此处曾维护**独立的第三份副本**且仅 23 条
//（缺 whatsapp / signal / matrix）⇒ 与另两处漂移，已收敛到单一事实源。

/**
 * 验证请求的共享密钥
 * @param req - HTTP 请求对象
 * @param apiSecret - 服务端配置的 API 密钥
 * @returns 是否通过验证
 */
export function verifyRequestAuth(
  req: http.IncomingMessage,
  apiSecret: string
): boolean {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    (req.headers['x-api-key'] as string) ||
    '';
  return token === apiSecret;
}

/**
 * 种子知识库：若用户知识库目录为空，从源码或内建默认文档初始化
 */
export async function seedKnowledgeBaseIfEmpty(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { resolvePyappHome } = await import('@modules/core/paths');

  const userKnowledgeDir = path.join(resolvePyappHome(), 'knowledge');

  // 若用户目录已存在 .md 文件，说明已初始化，跳过
  try {
    const userFiles = await fs.readdir(userKnowledgeDir);
    if (userFiles.some((f: string) => f.endsWith('.md'))) {
      return;
    }
  } catch (_err) {
    // 目录不存在，继续初始化
  }

  await fs.mkdir(userKnowledgeDir, { recursive: true });

  // 拷贝源：1) 项目源码路径（开发环境）
  try {
    const { resolveKnowledgeBaseDir } = await import('@modules/core/paths');
    const sourceDir = resolveKnowledgeBaseDir();
    const sourceFiles = await fs.readdir(sourceDir);
    const mdFiles = sourceFiles.filter((f: string) => f.endsWith('.md'));
    if (mdFiles.length > 0) {
      for (const file of mdFiles) {
        const content = await fs.readFile(path.join(sourceDir, file), 'utf-8');
        await fs.writeFile(path.join(userKnowledgeDir, file), content, 'utf-8');
      }
      logger.info(
        `知识库种子完成：从 ${sourceDir} 复制了 ${mdFiles.length} 个文件`
      );
      return;
    }
  } catch (_err) {
    // 源码目录不可用，继续兜底
  }

  // 拷贝源：2) 内建默认文档（兜底，适用于打包生产环境）
  await writeDefaultKnowledgeDocs(userKnowledgeDir, fs, path);
}

/**
 * 写入内建默认知识库文档（无任何外部源时的最终兜底）
 */
async function writeDefaultKnowledgeDocs(
  dir: string,
  fs: typeof import('fs/promises'),
  path: typeof import('path')
): Promise<void> {
  const docs: Array<{ fileName: string; content: string }> = [
    {
      fileName: 'index.md',
      content: [
        '# 用户知识库',
        '',
        '欢迎使用你的个人知识库！你可以在此保存笔记、代码片段和学习资料。',
        '',
        '## 快速开始',
        '',
        '使用右侧表单创建你的第一篇知识文档。',
        '',
        '## 文档管理',
        '',
        '- **创建**：填入标题和内容，点击"创建"',
        '- **编辑**：点击文档标题进入编辑模式',
        '- **搜索**：使用搜索框快速查找内容',
        '- **删除**：移除不再需要的文档',
        '',
        '## 支持格式',
        '',
        '你的知识文档支持完整的 Markdown 语法：',
        '- 标题、列表、表格',
        '- **加粗**、*斜体*、~~删除线~~',
        '- `代码块` 和语法高亮',
        '- [链接](#) 和图片',
        '',
      ].join('\n'),
    },
    {
      fileName: '示例文档.md',
      content: [
        '# 示例文档',
        '',
        '> 创建于 2026-05-22',
        '',
        '这是一个示例知识库文档，用于演示知识库功能。',
        '',
        '## 功能',
        '',
        '- 支持 Markdown 格式',
        '- 支持代码块',
        '- 支持列表',
        '- 支持链接',
        '',
        '## 代码示例',
        '',
        '```typescript',
        '// 示例 TypeScript 代码',
        'function greet(name: string): string {',
        '  return `Hello, ${name}!`;',
        '}',
        '',
        "console.log(greet('World'));",
        '```',
        '',
        '## 列表',
        '',
        '- 第一项',
        '- 第二项',
        '- 第三项',
        '',
        '## 链接',
        '',
        '[查看项目文档](/docs)',
        '',
      ].join('\n'),
    },
  ];

  for (const doc of docs) {
    const filePath = path.join(dir, doc.fileName);
    try {
      await fs.writeFile(filePath, doc.content, 'utf-8');
      logger.info(`已写入默认知识文档：${filePath}`);
    } catch (err) {
      void handleError(err, {
        module: 'infrastructure:http:helpers',
        action: 'writeDefaultDoc',
        context: { filePath },
      });
    }
  }
}

/**
 * 启动编译调度器
 * 仅在 AI 服务已配置默认模型时才启用 runOnStart，避免无模型时大量编译失败
 */
export async function startCompileScheduler(): Promise<{
  stop: () => void;
} | null> {
  try {
    const aiOps = await getCoreAPI().getAiOpsPort();
    // ⚠️ 句柄须为**真对象**（原样透传给知识库编译端口）
    const aiService = await aiOps.getAiServiceHandle();
    const defaultModel = await aiOps.getDefaultAiModel();
    if (!defaultModel) {
      logger.warning(
        '知识库编译调度器跳过首次编译：未配置默认模型，调度器仍按周期运行'
      );
    }

    // 说明：调度器构造 / start() / notifyFileChanged DI 注册均已内聚到端口实现
    // （原语义：notifyFileChanged ⇒ 上传非 md 文件后延迟触发编译，由 handler-utils 委托至此）
    return await getCoreAPI()
      .getKnowledgeOpsPort()
      .then((port) =>
        port.startKnowledgeCompileScheduler(
          aiService,
          { model: defaultModel || undefined, runOnStart: !!defaultModel },
          setNotifyFileChangedHandler
        )
      );
  } catch (err) {
    void handleError(err, {
      module: 'infrastructure:http:helpers',
      action: 'startCompileScheduler',
    });
    return null;
  }
}

// 2026-09-30（台账 D-135）：此处原有 `tryDynamicRegister` + `bindInboundMessageHandler` 的**整份副本**，
// 但**全仓零调用方**（`bindInboundMessageHandler` 仅被该副本内部调用）⇒ 死代码，已删除。
// ⚠️ 删除理由不止"未使用"：该副本停留在 **P0-4 之前** —— 其配置合并走**明文**
// （`channelRegistry.getConfig(type)?.options`），而 `handlers/channel-handlers.ts` 的**活实现**已改为
// 「先解密 → 合并前端凭据 → `encryptOptions()` 加密落库」。保留陈旧副本会被误用 ⇒ 凭据**明文落库**。
// 活实现位置：`infrastructure/http/handlers/channel-handlers.ts` 的 `tryDynamicRegister()`（3 处调用）。

/**
 * 递归复制目录
 * 跳过迁移标记文件（.migrating, .migration_committed）
 */
export function copyDirectory(
  src: string,
  dest: string,
  fs: {
    existsSync(p: string): boolean;
    mkdirSync(p: string, opts?: { recursive?: boolean }): void;
    readdirSync(
      p: string,
      opts?: { withFileTypes?: boolean }
    ): Array<{ name: string; isDirectory(): boolean }>;
    copyFileSync(src: string, dest: string): void;
  },
  path: { join(...segments: string[]): string }
): { copied: number; skipped: number; errors: string[] } {
  let copied = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (!fs.existsSync(src)) {
    return { copied, skipped, errors };
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.migrating' || entry.name === '.migration_committed') {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    try {
      if (entry.isDirectory()) {
        const result = copyDirectory(srcPath, destPath, fs, path);
        copied += result.copied;
        skipped += result.skipped;
        errors.push(...result.errors);
      } else {
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        } else {
          skipped++;
        }
      }
    } catch (err) {
      errors.push(`复制 ${srcPath} 失败: ${(err as Error).message}`);
    }
  }

  return { copied, skipped, errors };
}
