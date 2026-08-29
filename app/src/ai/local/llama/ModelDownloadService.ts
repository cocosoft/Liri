/**
 * ModelDownloadService — 模型下载与配置服务
 *
 * 从 ModelScope 下载 GGUF 模型并自动配置。
 * 设计文档：dev_docs/20260819/llama_cpp模型目录配置与迁移功能设计方案.md
 */

import { getLogger } from '@modules/monitoring';
import { resolveLlamaModelsDir } from '@modules/core/paths';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { createHash } from 'crypto';
import { stat, mkdir, writeFile, rename, open, unlink } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// KB-R11-LOGGER（2026-08-29）：new Logger 直接构造 → getLogger 门面（R11-001 合规）
const logger = getLogger('ai:llama:download');

/** 下载的模型信息 */
export interface DownloadedModelInfo {
  modelId: string;
  modelName: string;
  filePath: string;
  fileSizeGB: number;
  checksum: string;
  downloadedAt: number;
}

/** 模型元数据（用于下载） */
export interface ModelDownloadRequest {
  modelId: string;
  quantVersion: string;
  fileSizeGB: number;
  qualityScore: number;
  suitability: 'high' | 'medium' | 'low';
  estimatedRamGB: number;
  recommendationReason: string;
}

/** 下载配置选项 */
export interface ModelDownloadOptions {
  autoStart?: boolean;
  modelsDir?: string;
  /** 进度回调（用于 SSE 推送） */
  onProgress?: DownloadProgressCallback;
}

/** 下载进度回调 */
export type DownloadProgressCallback = (progress: {
  downloadedMB: number;
  totalMB: number;
  percent: number;
  speedMBs: number;
}) => void;

/**
 * 模型下载服务
 */
export class ModelDownloadService {
  private readonly defaultModelsDir: string;

  constructor(modelsDir?: string) {
    this.defaultModelsDir = modelsDir || resolveLlamaModelsDir();
  }

  /**
   * 下载模型并完成配置
   */
  async downloadAndConfigure(
    model: ModelDownloadRequest,
    options: ModelDownloadOptions = {}
  ): Promise<DownloadedModelInfo> {
    const { autoStart = false, modelsDir, onProgress } = options;
    const targetDir = modelsDir || this.defaultModelsDir;
    const startTime = Date.now();

    // 估算总大小（MB）用于进度计算
    const estimatedTotalMB = model.fileSizeGB * 1024;
    const emitProgress = (downloadedMB: number, speedMBs: number) => {
      onProgress?.({
        downloadedMB,
        totalMB: estimatedTotalMB,
        percent:
          estimatedTotalMB > 0
            ? Math.min(99, Math.round((downloadedMB / estimatedTotalMB) * 100))
            : 0,
        speedMBs,
      });
    };

    emitProgress(0, 0);

    logger.info('开始执行模型下载配置流程', {
      modelId: model.modelId,
      quantVersion: model.quantVersion,
      qualityScore: model.qualityScore,
      suitability: model.suitability,
      estimatedRamGB: model.estimatedRamGB,
      autoStart,
      targetDir,
    });

    // 1. 确保目标目录存在
    logger.debug('检查目标目录', { targetDir });
    await this._ensureDirectory(targetDir);

    // 2. 构建下载信息
    const fileName = `${model.modelId}-${model.quantVersion}.gguf`;
    const filePath = join(targetDir, fileName);

    logger.info('开始下载模型', {
      modelId: model.modelId,
      quantVersion: model.quantVersion,
      targetDir,
      filePath,
      fileSizeGB: model.fileSizeGB,
      qualityScore: model.qualityScore,
      suitability: model.suitability,
      estimatedRamGB: model.estimatedRamGB,
      recommendationReason: model.recommendationReason,
    });

    // 检查是否已存在同名文件
    if (existsSync(filePath)) {
      const existingSize = (await stat(filePath)).size / 1024 ** 3;
      logger.warn('目标文件已存在，将被覆盖', {
        filePath,
        existingSizeGB: existingSize.toFixed(2),
      });
    }

    // 3. 执行下载（带进度轮询）
    logger.info('进入下载阶段', { method: 'auto-detect' });
    const downloadStart = Date.now();
    let downloadDurationMs = 0;

    // 启动后台进度轮询（每 2 秒检查临时文件大小）
    let pollTimer: NodeJS.Timeout | null = null;
    try {
      if (onProgress) {
        pollTimer = setInterval(() => {
          try {
            if (existsSync(filePath)) {
              const mb = statSync(filePath).size / (1024 * 1024);
              const elapsedMs = Date.now() - downloadStart;
              const speedMBs = elapsedMs > 0 ? mb / (elapsedMs / 1000) : 0;
              emitProgress(mb, speedMBs);
            }
          } catch (pollErr) {
            // KB-R08-POLL-PROGRESS（2026-08-29）：下载进度轮询异常记录（R08-002 后台
            // 循环 fail 事件落盘——原 catch 静默忽略）
            logger.warn('模型下载进度轮询异常', {
              error:
                pollErr instanceof Error ? pollErr.message : String(pollErr),
            });
          }
        }, 2000);
      }

      const downloadResult = await this._downloadFromModelscope(
        model.modelId,
        model.quantVersion,
        filePath
      );
      downloadDurationMs = Date.now() - downloadStart;
      logger.info('下载阶段完成', {
        durationMs: downloadDurationMs,
        success: downloadResult.success,
      });

      if (!downloadResult.success) {
        logger.error('下载失败，后续步骤跳过', { filePath });
        throw new Error(`下载失败：${model.modelId}-${model.quantVersion}`);
      }

      // 下载完成，立即推送 100%
      if (existsSync(filePath)) {
        const finalMB = (await stat(filePath)).size / (1024 * 1024);
        emitProgress(finalMB, 0);
      }
    } finally {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    // 4. 校验文件
    logger.info('校验下载文件', {
      filePath,
      expectedSizeGB: model.fileSizeGB,
    });
    const verifyStart = Date.now();
    const fileSizeGB = await this._verifyFile(filePath, model.fileSizeGB);
    logger.info('文件校验完成', {
      filePath,
      actualSizeGB: fileSizeGB,
      durationMs: Date.now() - verifyStart,
    });

    // 5. 生成 checksum
    logger.info('计算文件 SHA256 checksum', { filePath });
    const checksumStart = Date.now();
    const checksum = await this._calculateChecksum(filePath);
    logger.info('Checksum 计算完成', {
      filePath,
      checksum: checksum.slice(0, 16) + '...',
      durationMs: Date.now() - checksumStart,
    });

    // 6. 注册模型（如有必要）
    if (autoStart) {
      logger.info('准备注册并自动启动模型', {
        modelId: model.modelId,
        filePath,
      });
      const registerStart = Date.now();
      await this._registerAndAutoStart(filePath, model);
      logger.info('模型注册启动完成', {
        modelId: model.modelId,
        durationMs: Date.now() - registerStart,
      });
    } else {
      logger.info('跳过自动启动（autoStart=false）', {
        modelId: model.modelId,
      });
    }

    const totalDurationMs = Date.now() - startTime;

    const result: DownloadedModelInfo = {
      modelId: model.modelId,
      modelName: `${model.modelId}-${model.quantVersion}`,
      filePath,
      fileSizeGB,
      checksum,
      downloadedAt: Date.now(),
    };

    logger.info('模型下载配置全流程完成', {
      modelId: model.modelId,
      modelName: result.modelName,
      filePath,
      fileSizeGB: result.fileSizeGB,
      checksum: result.checksum.slice(0, 16) + '...',
      totalDurationMs,
      breakdown: {
        downloadMs: downloadDurationMs,
        verifyMs: Date.now() - verifyStart,
        checksumMs: Date.now() - checksumStart,
      },
    });

    return result;
  }

  /**
   * 从 ModelScope 下载模型
   */
  private async _downloadFromModelscope(
    modelId: string,
    quantVersion: string,
    targetPath: string
  ): Promise<{ success: boolean }> {
    // 构建 ModelScope 模型路径
    const modelScopePath = this._buildModelScopePath(modelId, quantVersion);
    logger.info('构建 ModelScope 下载路径', {
      modelId,
      quantVersion,
      modelScopePath,
    });

    // 尝试使用 huggingface-cli 下载（兼容 ModelScope 镜像）
    try {
      logger.info('尝试方式 1/3: huggingface-cli', {
        versionCheck: 'huggingface-cli --version',
      });
      // 检查 huggingface-cli 是否可用
      const { stdout: hfVersion } = await execAsync(
        'huggingface-cli --version',
        { timeout: 5000 }
      );
      logger.info('huggingface-cli 可用', { version: hfVersion.trim() });

      // 使用 huggingface-cli 下载
      const downloadCmd = `huggingface-cli download ${modelScopePath} --local-dir "${dirname(targetPath)}" --include "${basename(targetPath)}"`;
      logger.info('执行下载命令', {
        method: 'huggingface-cli',
        cmd: downloadCmd.replace(
          modelScopePath,
          `${modelScopePath.slice(0, 20)}...`
        ),
        targetPath,
      });

      const downloadStart = Date.now();
      await execAsync(downloadCmd, {
        timeout: 3600_000, // 1 hour timeout
        maxBuffer: 10 * 1024 * 1024,
      });
      const durationMs = Date.now() - downloadStart;

      // 验证文件是否下载成功
      if (!existsSync(targetPath)) {
        logger.error('huggingface-cli 下载完成但文件不存在', { targetPath });
        throw new Error('下载命令执行但文件未生成');
      }

      const fileSizeGB = (await stat(targetPath)).size / 1024 ** 3;
      logger.info('huggingface-cli 下载成功', {
        targetPath,
        fileSizeGB: fileSizeGB.toFixed(2),
        durationMs,
      });

      return { success: true };
    } catch (err: any) {
      const errorInfo = {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
      };
      logger.warn('huggingface-cli 下载失败', {
        method: 'huggingface-cli',
        error: errorInfo,
        willRetry: true,
      });

      // 备选方案：使用 Python 脚本下载
      try {
        logger.info('尝试方式 2/3: Python huggingface_hub', {
          modelScopePath,
        });
        return await this._downloadWithPython(modelScopePath, targetPath);
      } catch (pythonErr: any) {
        logger.error('Python 下载也失败', {
          method: 'python',
          error: {
            message: pythonErr.message,
            code: pythonErr.code,
          },
          willRetry: true,
        });

        // 最后备选：直接用 curl/wget
        try {
          logger.info('尝试方式 3/3: curl/wget 直连下载', {
            modelScopePath,
          });
          return await this._downloadWithCurl(modelScopePath, targetPath);
        } catch (curlErr: any) {
          logger.error('所有下载方式均失败', {
            attempts: 3,
            finalError: {
              message: curlErr.message,
              code: curlErr.code,
            },
            modelId,
            quantVersion,
            targetPath,
          });
          throw new Error(
            `无法下载模型 ${modelId}-${quantVersion}，请手动下载后放置于 ${targetPath}`
          );
        }
      }
    }
  }

  /**
   * 使用 Python 下载
   */
  private async _downloadWithPython(
    modelPath: string,
    targetPath: string
  ): Promise<{ success: boolean }> {
    logger.info('准备 Python 下载脚本', {
      modelPath,
      targetPath,
      huggingfaceHubMethod: 'snapshot_download',
    });

    const path = await import('path');
    const script = `
import sys
from huggingface_hub import snapshot_download
import os
import time

start = time.time()
try:
    local_dir = r"${path.dirname(targetPath)}"
    print(f"开始下载到: {local_dir}")
    snapshot_download(repo_id="${modelPath}", local_dir=local_dir, max_workers=4)
    elapsed = time.time() - start
    print(f"SUCCESS 耗时: {elapsed:.1f}秒")
except Exception as e:
    elapsed = time.time() - start
    print(f"ERROR 耗时: {elapsed:.1f}秒")
    print(f"ERROR_TYPE: {type(e).__name__}")
    print(f"ERROR_MSG: {e}")
    sys.exit(1)
`;

    const tmpScript = join(this.defaultModelsDir, '.download.py');
    logger.debug('写入临时下载脚本', {
      tmpScript,
      scriptSize: script.length,
    });
    await writeFile(tmpScript, script);

    try {
      logger.info('执行 Python 下载脚本', {
        scriptPath: tmpScript,
        pythonCmd: 'python',
        timeout: '3600s',
      });
      const execStart = Date.now();
      const { stdout, stderr } = await execAsync(`python "${tmpScript}"`, {
        timeout: 3600_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const durationMs = Date.now() - execStart;

      logger.info('Python 脚本执行完成', {
        durationMs,
        stdout: stdout.slice(-500),
        hasErrors: stderr.length > 0,
      });

      if (stderr.length > 0) {
        logger.warn('Python 脚本有 stderr 输出', {
          stderr: stderr.slice(-300),
        });
      }

      const success = stdout.includes('SUCCESS');

      if (success) {
        // 验证文件
        if (existsSync(targetPath)) {
          const fileSizeGB = (await stat(targetPath)).size / 1024 ** 3;
          logger.info('Python 下载成功', {
            targetPath,
            fileSizeGB: fileSizeGB.toFixed(2),
            durationMs,
          });
        } else {
          logger.error('Python 下载完成但目标文件不存在', { targetPath });
          return { success: false };
        }
      } else {
        logger.error('Python 下载失败', {
          stdout: stdout.slice(-300),
          durationMs,
        });
      }

      return { success };
    } catch (err: any) {
      logger.error('Python 脚本执行异常', {
        errorMessage: err.message,
        errorCode: err.code,
        stdout: err.stdout?.slice(-300) || 'N/A',
        stderr: err.stderr?.slice(-300) || 'N/A',
      });
      throw err;
    } finally {
      // 清理临时脚本
      try {
        const fs = await import('fs');
        await fs.promises.unlink(tmpScript);
        logger.debug('已清理临时脚本', { tmpScript });
      } catch (cleanupErr) {
        logger.debug('清理临时脚本失败（非关键）', {
          tmpScript,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }
  }

  /**
   * 使用 curl 下载（最后备选）
   */
  private async _downloadWithCurl(
    modelPath: string,
    targetPath: string
  ): Promise<{ success: boolean }> {
    // ModelScope 直接下载链接
    const downloadUrl = `https://www.modelscope.cn/api/v1/models/${modelPath}/repo?Revision=master`;

    logger.info('准备 curl/wget 下载', {
      modelPath,
      downloadUrl: downloadUrl.slice(0, 80) + '...',
      targetPath,
    });

    try {
      // 先尝试 curl
      logger.info('尝试 curl 下载', {
        cmd: `curl -L -o "${targetPath}" "${downloadUrl}"`,
      });
      const curlStart = Date.now();
      const cmd = `curl -L -o "${targetPath}" "${downloadUrl}" --connect-timeout 30 --max-time 3600`;
      await execAsync(cmd, {
        timeout: 3600_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const durationMs = Date.now() - curlStart;

      if (existsSync(targetPath)) {
        const fileSizeGB = (await stat(targetPath)).size / 1024 ** 3;
        logger.info('curl 下载成功', {
          targetPath,
          fileSizeGB: fileSizeGB.toFixed(2),
          durationMs,
        });
        return { success: true };
      }
      logger.warn('curl 执行完成但目标文件不存在', { targetPath });
      return { success: false };
    } catch (curlErr: any) {
      logger.warn('curl 下载失败，尝试 wget', {
        curlError: {
          message: curlErr.message,
          code: curlErr.code,
        },
      });

      // curl 失败，尝试 wget
      try {
        logger.info('尝试 wget 下载', {
          cmd: `wget -O "${targetPath}"`,
        });
        const wgetStart = Date.now();
        const wgetCmd = `wget -O "${targetPath}" "${downloadUrl}" --timeout=30 --tries=3`;
        await execAsync(wgetCmd, { timeout: 3600_000 });
        const durationMs = Date.now() - wgetStart;

        const exists = existsSync(targetPath);
        if (exists) {
          const fileSizeGB = (await stat(targetPath)).size / 1024 ** 3;
          logger.info('wget 下载成功', {
            targetPath,
            fileSizeGB: fileSizeGB.toFixed(2),
            durationMs,
          });
        } else {
          logger.error('wget 执行完成但文件不存在', { targetPath });
        }

        return { success: exists };
      } catch (wgetErr: any) {
        logger.error('curl 和 wget 均不可用', {
          curlError: curlErr.message,
          wgetError: wgetErr.message,
          targetPath,
          suggestion: '请手动下载模型文件',
        });
        throw new Error('curl 和 wget 均不可用，请手动下载');
      }
    }
  }

  /**
   * 构建 ModelScope 路径
   */
  private _buildModelScopePath(modelId: string, quantVersion: string): string {
    // ModelScope 上的模型组织
    const modelMap: Record<string, string> = {
      qwen3: 'qwen',
      'qwen3.5': 'qwen',
      'llama3.2': 'LLM-Research',
      'llama3.1': 'LLM-Research',
      gemma3: 'google',
      'deepseek-r1': 'deepseek-ai',
    };

    // 从 modelId 提取基础模型名
    const baseModelId = modelId.split('-').slice(0, -1).join('-');
    const org = modelMap[baseModelId] || 'modelscope';

    return `${org}/${modelId}-${quantVersion}-GGUF`;
  }

  /**
   * 确保目录存在
   */
  private async _ensureDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      logger.info('目录不存在，正在创建', { dir });
      const createStart = Date.now();
      await mkdir(dir, { recursive: true });
      logger.info('目录创建完成', {
        dir,
        durationMs: Date.now() - createStart,
      });
    } else {
      logger.debug('目录已存在', { dir });
    }
  }

  /**
   * 验证文件大小
   */
  private async _verifyFile(
    filePath: string,
    expectedSizeGB: number
  ): Promise<number> {
    logger.debug('开始文件大小验证', {
      filePath,
      expectedSizeGB,
    });
    const verifyStart = Date.now();
    const fileStat = await stat(filePath);
    const actualSizeGB = fileStat.size / 1024 ** 3;
    const durationMs = Date.now() - verifyStart;

    logger.info('文件大小验证完成', {
      expectedGB: expectedSizeGB.toFixed(2),
      actualGB: actualSizeGB.toFixed(2),
      fileSizeBytes: fileStat.size,
      filePath,
      durationMs,
    });

    // 允许 10% 的误差
    const tolerance = expectedSizeGB * 0.1;
    const diffGB = Math.abs(actualSizeGB - expectedSizeGB);

    if (diffGB > tolerance) {
      logger.warn('文件大小与预期不符', {
        expectedGB: expectedSizeGB.toFixed(2),
        actualGB: actualSizeGB.toFixed(2),
        diffGB: diffGB.toFixed(2),
        toleranceGB: tolerance.toFixed(2),
        ratio: `${((actualSizeGB / expectedSizeGB) * 100).toFixed(1)}%`,
      });
    } else {
      logger.debug('文件大小在预期范围内', {
        diffGB: diffGB.toFixed(4),
        toleranceGB: tolerance.toFixed(2),
      });
    }

    // AC-3 根因修复（2026-08-20）：GGUF 魔数校验。
    // 事故复盘：CDN 返回的 JSON 错误体（139 字节，如"参数错误：文件路径不能为空"）
    // 曾被当作模型文件落盘，大小校验仅 warn 放行 → llama-server 反复加载失败退避
    // 重启 21 次。魔数不符 = 必然非 GGUF 文件，删除并中断流程，防止残留损坏文件。
    const handle = await open(filePath, 'r');
    let magic = '';
    try {
      const buf = Buffer.alloc(4);
      await handle.read(buf, 0, 4, 0);
      magic = buf.toString('ascii');
    } finally {
      await handle.close();
    }
    if (magic !== 'GGUF') {
      logger.error('GGUF 魔数校验失败，删除损坏文件', {
        filePath,
        actualMagic: JSON.stringify(magic),
        fileSizeBytes: fileStat.size,
        hint: '下载源返回了非 GGUF 内容（通常是 JSON 错误体），已删除防止反复加载失败',
      });
      try {
        await unlink(filePath);
      } catch (unlinkErr) {
        logger.warn('损坏文件删除失败，请手动删除', {
          filePath,
          error: String(unlinkErr),
        });
      }
      throw new AppError(
        `GGUF 魔数校验失败：文件头为 ${JSON.stringify(magic)}（预期 "GGUF"），` +
          `下载源可能返回了错误响应，损坏文件已删除：${filePath}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'GGUF_MAGIC_INVALID',
        {
          filePath,
          expectedMagic: 'GGUF',
          actualMagic: magic,
          fileSizeBytes: fileStat.size,
          hint: '下载源通常返回 JSON 错误体，已自动清理损坏文件，请在模型管理重新下载',
        }
      );
    }
    logger.debug('GGUF 魔数校验通过', { filePath, magic });

    return Math.round(actualSizeGB * 10) / 10;
  }

  /**
   * 计算文件 SHA256 checksum
   */
  private async _calculateChecksum(filePath: string): Promise<string> {
    logger.info('开始计算 SHA256 checksum', { filePath });

    const fs = await import('fs');
    const fileStream = fs.createReadStream(filePath);
    const hash = createHash('sha256');
    const calcStart = Date.now();

    return new Promise((resolve, reject) => {
      let bytesHashed = 0;

      fileStream.on('data', (chunk: string | Buffer) => {
        hash.update(chunk);
        bytesHashed += chunk.length;
        // 每 500MB 输出一次进度
        if (bytesHashed % (500 * 1024 * 1024) < chunk.length) {
          logger.debug('checksum 计算中', {
            filePath,
            bytesHashed: `${(bytesHashed / 1024 ** 3).toFixed(2)}GB`,
          });
        }
      });

      fileStream.on('end', () => {
        const checksum = hash.digest('hex');
        const durationMs = Date.now() - calcStart;
        const fileSizeGB = bytesHashed / 1024 ** 3;

        logger.info('SHA256 checksum 计算完成', {
          filePath,
          checksum,
          fileSizeGB: fileSizeGB.toFixed(2),
          durationMs,
          speedMBs: Math.round((fileSizeGB * 1024) / (durationMs / 1000)),
        });
        resolve(checksum);
      });

      fileStream.on('error', (err: Error) => {
        logger.error('checksum 计算失败', {
          filePath,
          errorMessage: err.message,
        });
        reject(err);
      });
    });
  }

  /**
   * 注册模型并自动启动服务
   */
  private async _registerAndAutoStart(
    filePath: string,
    model: ModelDownloadRequest
  ): Promise<void> {
    const registerStart = Date.now();

    logger.info('开始注册模型并配置自动启动', {
      modelId: model.modelId,
      filePath,
      modelConfig: {
        qualityScore: model.qualityScore,
        suitability: model.suitability,
        estimatedRamGB: model.estimatedRamGB,
      },
    });

    try {
      const { llamaCppServerManager } =
        await import('@modules/ai/local/llama/LlamaCppServerManager.js');

      // 更新配置：设置模型路径并启用自动启动
      logger.debug('更新 llama-server 配置', {
        model: filePath,
        autoStart: true,
      });
      await llamaCppServerManager.updateConfig({
        model: filePath,
        autoStart: true,
      });

      // 启动服务
      logger.info('启动 llama-server 服务', { model: filePath });
      const startStart = Date.now();
      await llamaCppServerManager.start();
      logger.info('llama-server 启动完成', {
        model: filePath,
        startDurationMs: Date.now() - startStart,
      });

      const totalDurationMs = Date.now() - registerStart;
      logger.info('模型注册启动全流程完成', {
        modelId: model.modelId,
        filePath,
        totalDurationMs,
      });
    } catch (err: any) {
      logger.error('模型注册启动失败', {
        modelId: model.modelId,
        filePath,
        errorMessage: err.message,
        errorCode: err.code,
        totalDurationMs: Date.now() - registerStart,
      });
      // 不抛出错误，下载成功即完成
      // 用户可以手动启动服务
    }
  }
}

/** 便捷函数：从文件路径提取目录名 */
function dirname(filePath: string): string {
  const path = require('path');
  return path.dirname(filePath);
}
