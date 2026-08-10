/**
 * STTStreamServer
 * 流式 STT WebSocket 端点（语音系统升级 3.4 / P1-1）
 *
 * 前端"按住说话"时通过 `/v1/voice/stt` 端点实时推 PCM16 16kHz mono chunks，
 * 后端累积音频，每达到节流阈值（时长/字节数）调用 `STTRegistry.transcribe`
 * 产生 interim 字幕回推；松手发 `finalize` 返回最终转录。
 * 字幕与最终转录走同一后端链路，消除浏览器 SpeechRecognition 双轨矛盾。
 *
 * 协议：
 *   客户端 TEXT   {"type":"config","language":"zh-CN","keyterms":[],"providerId":"local"}
 *                 {"type":"finalize"}   {"type":"abort"}
 *   客户端 BINARY PCM16 16kHz mono 原始字节（无容器头）
 *   服务端 TEXT   {"type":"ready"}
 *                 {"type":"interim","text":"...","confidence":0.9}
 *                 {"type":"final","text":"...","segments":[...],"language":"zh"}
 *                 {"type":"error","message":"..."}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { STTRegistry } from '@modules/services/voice/services/sttRegistry';
import { upgradeToVoiceConnection } from './upgrade';
import type { VoiceConnection } from './types';

const logger = getLogger('voice:sttStream');

/** interim 转写节流：音频达到该时长（秒）即触发 */
const INTERIM_MIN_SECONDS = 2.5;
/** interim 转写节流：音频达到该字节数即触发（2.5s * 16kHz * 2B ≈ 80KB） */
const INTERIM_MIN_BYTES = 80 * 1024;
/** 单次转写的最大音频时长（秒），超过则只取尾部，防止转录过长音频耗时 */
const MAX_TRANSCRIBE_SECONDS = 30;

/** 会话配置 */
interface STTSessionConfig {
  language?: string;
  keyterms?: string[];
  providerId?: string;
}

/**
 * 单个流式 STT 会话
 * 累积 PCM → 节流转写（interim）→ finalize 最终转录
 */
class STTStreamSession {
  private audioBuffer: Buffer = Buffer.alloc(0);
  private config: STTSessionConfig = {};
  private configured = false;
  private finalized = false;
  private transcribing: Promise<void> | null = null;
  /** 上一次 interim 转写的起始时间戳 */
  private lastInterimAt = 0;

  constructor(
    private conn: VoiceConnection,
    private remove: (id: string) => void
  ) {
    this.conn.onMessage((event) =>
      this.handleMessage(event as unknown as Record<string, unknown>)
    );
    this.conn.onBinary((data) => this.handleBinary(data));
    this.conn.onClose(() => this.cleanup());
  }

  private handleMessage(event: Record<string, unknown>): void {
    const type = String(event.type ?? '');

    if (type === 'config') {
      this.config = {
        language:
          typeof event.language === 'string' ? event.language : undefined,
        keyterms: Array.isArray(event.keyterms)
          ? (event.keyterms as string[])
          : undefined,
        providerId:
          typeof event.providerId === 'string' ? event.providerId : undefined,
      };
      this.configured = true;
      this.conn.send({ type: 'ready' } as never);
      return;
    }

    if (type === 'finalize') {
      this.finalize();
      return;
    }

    if (type === 'abort') {
      this.audioBuffer = Buffer.alloc(0);
      this.conn.close(1000, 'aborted');
      this.remove(this.conn.id);
      return;
    }
  }

  private handleBinary(data: Buffer): void {
    if (!this.configured || this.finalized || data.length === 0) return;
    this.audioBuffer = Buffer.concat([this.audioBuffer, data]);
    // 内存保护（§6 同类防御）：audioBuffer 只保留最近 MAX_TRANSCRIBE_SECONDS 音频（滑窗），
    // 防止异常/长时推流导致内存无限增长；转录目标恒为"最近 30s"，与 trimSnapshot 语义一致
    this.audioBuffer = this.trimSnapshot();

    // 节流：达到时长/字节阈值且当前无转写进行中 → 触发 interim
    if (
      !this.transcribing &&
      (this.audioBuffer.length >= INTERIM_MIN_BYTES ||
        (this.lastInterimAt > 0 &&
          Date.now() - this.lastInterimAt >= INTERIM_MIN_SECONDS * 1000))
    ) {
      this.triggerInterim();
    }
  }

  /** 触发一次 interim 转写（节流 + 防并发） */
  private triggerInterim(): void {
    const snapshot = this.trimSnapshot();
    if (snapshot.length < 256) return; // 过短音频跳过（STTCache 最小阈值）

    this.lastInterimAt = Date.now();
    this.transcribing = this.runTranscribe(snapshot, 'interim').finally(() => {
      this.transcribing = null;
    });
  }

  /** 截取用于转写的音频快照（限长取尾） */
  private trimSnapshot(): Buffer {
    const maxBytes = MAX_TRANSCRIBE_SECONDS * 16000 * 2;
    if (this.audioBuffer.length <= maxBytes) return this.audioBuffer;
    return this.audioBuffer.subarray(this.audioBuffer.length - maxBytes);
  }

  /** 执行一次转写并回推结果 */
  private async runTranscribe(
    audio: Buffer,
    kind: 'interim' | 'final'
  ): Promise<void> {
    try {
      const result = await STTRegistry.transcribe(
        audio,
        {
          language: this.config.language,
          keyterms: this.config.keyterms,
        },
        this.config.providerId
      );

      if (kind === 'final' || (result.text && result.text.trim())) {
        this.conn.send({
          type: kind,
          text: result.text || '',
          confidence: result.confidence ?? 0,
          segments: result.segments ?? [],
          language: result.language,
        } as never);
      }
    } catch (error) {
      void handleError(error, {
        module: 'voice:sttStream',
        action: `转写失败:${kind}`,
      });
      this.conn.send({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } as never);
    }
  }

  /** finalize：等待进行中的 interim 完成，转写全部音频并回推 final */
  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;

    const snapshot = this.trimSnapshot();
    const finish = (): void => {
      void this.runTranscribe(snapshot, 'final').then(() => {
        this.remove(this.conn.id);
      });
    };

    if (this.transcribing) {
      this.transcribing.then(finish).catch(finish);
    } else {
      finish();
    }
  }

  private cleanup(): void {
    this.remove(this.conn.id);
  }

  /** 服务端主动关闭（服务关闭/超时） */
  close(): void {
    this.finalized = true;
    this.conn.close(1001, 'server shutdown');
    this.remove(this.conn.id);
  }
}

/** 活跃会话映射 */
const sessions = new Map<string, STTStreamSession>();

/**
 * 处理 `/v1/voice/stt` 端点的 WebSocket 升级请求
 * 由 LocalHTTPService 的 upgrade 事件分发调用。
 *
 * @returns VoiceConnection 实例，升级失败返回 null
 */
export function upgradeSTTStreamConnection(
  req: IncomingMessage,
  res: ServerResponse
): VoiceConnection | null {
  const conn = upgradeToVoiceConnection(req, res);
  if (!conn) return null;

  const session = new STTStreamSession(conn, (id) => {
    sessions.delete(id);
  });
  sessions.set(conn.id, session);

  logger.info('流式 STT 会话已建立', {
    sessionId: conn.id,
    activeCount: sessions.size,
  });

  return conn;
}

/**
 * 关闭所有活跃的流式 STT 会话（服务关闭时调用）
 */
export function closeAllSTTStreamSessions(): void {
  const count = sessions.size;
  for (const [, session] of sessions) {
    session.close();
  }
  logger.info('所有流式 STT 会话已关闭', { count });
}

/**
 * 当前活跃会话数
 */
export function getActiveSTTStreamCount(): number {
  return sessions.size;
}
