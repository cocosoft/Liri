/**
 * 媒体文件处理 handler
 *
 * 提供媒体文件导入 → 音频提取 → STT 转录 → 字幕导出的完整管线。
 *
 * 端点：
 *   POST /v1/media/subtitle — 上传媒体文件并生成字幕
 *   GET  /v1/media/subtitle/:id/download — 下载字幕文件（SRT/TXT）
 */

import type http from 'http';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveTempDir } from '@modules/core/paths';
import { videoProcessor } from '../../../media/video/VideoProcessor';

const logger = new Logger({ module: 'http:media' });

/** 支持的媒体文件扩展名 */
const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.wma',
  '.opus',
  '.webm',
]);
const SUPPORTED_VIDEO_EXTS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
]);

/** 字幕生成结果缓存（内存中，应用重启即丢失） */
const subtitleCache = new Map<string, SubtitleResult>();

/** 字幕条目 */
interface SubtitleEntry {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** 字幕生成结果 */
interface SubtitleResult {
  id: string;
  fileName: string;
  text: string;
  language: string;
  duration: number;
  segments: SubtitleEntry[];
  createdAt: number;
}

/**
 * 读取请求体（multipart 解析简化版）
 */
async function readMultipartBody(
  req: http.IncomingMessage
): Promise<{ fileName: string; data: Buffer } | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      // 解析 multipart/form-data boundary
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (!boundaryMatch) {
        resolve(null);
        return;
      }

      const boundary = boundaryMatch[1].trim();
      const boundaryBuffer = Buffer.from(`--${boundary}`);

      // 查找文件部分
      let startIdx = raw.indexOf(boundaryBuffer);
      while (startIdx !== -1) {
        const headerEnd = raw.indexOf('\r\n\r\n', startIdx);
        if (headerEnd === -1) break;

        const headerSection = raw.slice(startIdx, headerEnd).toString();
        const nextBoundary = raw.indexOf(boundaryBuffer, headerEnd + 4);
        const bodyEnd = nextBoundary !== -1 ? nextBoundary - 2 : raw.length - 2;

        if (headerSection.includes('filename=')) {
          // 提取文件名
          const filenameMatch = headerSection.match(/filename="([^"]+)"/);
          const fileName = filenameMatch ? filenameMatch[1] : 'unknown';

          const fileData = raw.slice(headerEnd + 4, bodyEnd);
          resolve({ fileName, data: fileData });
          return;
        }

        startIdx = raw.indexOf(boundaryBuffer, bodyEnd);
      }

      resolve(null);
    });

    req.on('error', () => resolve(null));
  });
}

/**
 * 将秒数格式化为 SRT 时间戳格式 (HH:MM:SS,mmm)
 */
function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * 生成 SRT 格式字幕文本
 */
function generateSRT(segments: SubtitleEntry[]): string {
  return segments
    .map((seg) => {
      return `${seg.index}\n${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}\n${seg.text}\n`;
    })
    .join('\n');
}

/**
 * 生成纯文本格式字幕
 */
function generateTXT(segments: SubtitleEntry[]): string {
  return segments.map((seg) => seg.text).join('\n');
}

/**
 * 根据转录音频时长将文本切分为固定间隔的字幕段落
 * STT 返回 segments 时直接使用；无 segments 时按 2 秒间隔切分
 */
function buildSegments(
  text: string,
  duration: number,
  rawSegments?: Array<{ text: string; start: number; end: number }>
): SubtitleEntry[] {
  if (rawSegments && rawSegments.length > 0) {
    return rawSegments.map((seg, i) => ({
      index: i + 1,
      start: seg.start,
      end: seg.end,
      text: seg.text,
    }));
  }

  // 无 segments 时按句子切分，均匀分配时间
  const sentences = text.split(/(?<=[。！？.!?\n])/).filter((s) => s.trim());
  if (sentences.length === 0) return [];

  const totalDuration = Math.max(duration, sentences.length * 2);
  const perSegment = totalDuration / sentences.length;

  return sentences.map((sentence, i) => ({
    index: i + 1,
    start: i * perSegment,
    end: Math.min((i + 1) * perSegment, totalDuration),
    text: sentence.trim(),
  }));
}

/**
 * 判断文件是否为音频文件
 */
function isAudioFile(fileName: string): boolean {
  return SUPPORTED_AUDIO_EXTS.has(extname(fileName).toLowerCase());
}

/**
 * 判断文件是否为视频文件
 */
function isVideoFile(fileName: string): boolean {
  return SUPPORTED_VIDEO_EXTS.has(extname(fileName).toLowerCase());
}

/**
 * 处理媒体文件字幕生成 POST /v1/media/subtitle
 *
 * 接受 multipart/form-data 上传的媒体文件（音频或视频），
 * 视频则先提取音频，再通过 STT 转录，返回字幕结果。
 */
export async function handleMediaSubtitleGenerate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsed = await readMultipartBody(req);
    if (!parsed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无法解析上传文件' }));
      return;
    }

    const { fileName, data } = parsed;
    const ext = extname(fileName).toLowerCase();

    if (!isAudioFile(fileName) && !isVideoFile(fileName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `不支持的文件格式 "${ext}"，支持的格式: ${[...SUPPORTED_AUDIO_EXTS, ...SUPPORTED_VIDEO_EXTS].join(', ')}`,
        })
      );
      return;
    }

    // 确保临时目录存在
    const tempDir = resolveTempDir();
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const taskId = randomUUID();
    const inputPath = join(tempDir, `media_${taskId}${ext}`);

    try {
      // 写入上传文件到临时目录
      writeFileSync(inputPath, data);

      let audioPath: string;

      // 视频文件 → 先提取音频
      if (isVideoFile(fileName)) {
        audioPath = join(tempDir, `audio_${taskId}.wav`);
        const success = await videoProcessor.extractAudio(inputPath, audioPath);
        if (!success || !existsSync(audioPath)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: '视频音频提取失败，请确认 ffmpeg 已安装' })
          );
          return;
        }
        // 清理视频临时文件
        try {
          unlinkSync(inputPath);
        } catch (err) {
          /* 清理失败不影响主流程 */
        }
      } else {
        audioPath = inputPath;
      }

      // 读取音频数据并转录
      const audioData = readFileSync(audioPath);

      const { STTRegistry } =
        await import('../../../services/voice/services/sttRegistry');

      // 确保默认提供者已注册
      if (STTRegistry.getAllProviders().length === 0) {
        const { LocalSTTProvider } =
          await import('../../../services/voice/services/localSTTProvider');
        STTRegistry.register(new LocalSTTProvider());
      }

      const sttResult = await STTRegistry.transcribe(audioData, {
        language: 'zh',
      });

      // 构建字幕条目
      const segments = buildSegments(
        sttResult.text,
        sttResult.duration || 0,
        sttResult.segments
      );

      // 保存结果到缓存
      const result: SubtitleResult = {
        id: taskId,
        fileName,
        text: sttResult.text,
        language: sttResult.language || 'zh',
        duration: sttResult.duration || 0,
        segments,
        createdAt: Date.now(),
      };
      subtitleCache.set(taskId, result);

      // 清理音频临时文件
      try {
        unlinkSync(audioPath);
      } catch (err) {
        /* 清理失败不影响主流程 */
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: taskId,
          fileName,
          text: sttResult.text,
          language: result.language,
          duration: result.duration,
          segments,
          downloadSrt: `/v1/media/subtitle/${taskId}/download?format=srt`,
          downloadTxt: `/v1/media/subtitle/${taskId}/download?format=txt`,
        })
      );
    } catch (err) {
      // 清理临时文件
      try {
        unlinkSync(inputPath);
      } catch (err) {
        /* ignore */
      }
      throw err;
    }
  } catch (err) {
    logger.error('媒体字幕生成失败', { error: String(err) });
    void handleError(err, {
      module: 'http:media',
      action: 'subtitle_generate',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '字幕生成失败' }));
  }
}

/**
 * 下载字幕文件 GET /v1/media/subtitle/:id/download?format=srt|txt
 */
export async function handleMediaSubtitleDownload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  try {
    const result = subtitleCache.get(id);
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '字幕结果不存在或已过期' }));
      return;
    }

    // 解析 format 查询参数
    const urlObj = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const format = urlObj.searchParams.get('format') || 'srt';

    let content: string;
    let contentType: string;
    let fileExt: string;

    if (format === 'srt') {
      content = generateSRT(result.segments);
      contentType = 'text/plain; charset=utf-8';
      fileExt = '.srt';
    } else if (format === 'txt') {
      content = generateTXT(result.segments);
      contentType = 'text/plain; charset=utf-8';
      fileExt = '.txt';
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '不支持的格式，请使用 srt 或 txt' }));
      return;
    }

    const baseName = result.fileName.replace(/\.[^.]+$/, '');
    const downloadName = encodeURIComponent(`${baseName}_subtitle${fileExt}`);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${downloadName}`,
    });
    res.end(content);
  } catch (err) {
    logger.error('字幕下载失败', { error: String(err) });
    void handleError(err, {
      module: 'http:media',
      action: 'subtitle_download',
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '下载失败' }));
  }
}
