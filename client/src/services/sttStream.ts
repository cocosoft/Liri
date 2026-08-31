/**
 * 流式 STT 客户端（3.4/P1-1）
 *
 * 建立后端 /v1/voice/stt WebSocket 连接，按住说话时实时推 PCM 获得字幕。
 * 字幕与最终转录走同一后端 STTRegistry 链路，消除浏览器 SpeechRecognition 双轨。
 * （2026-08-31 自 voiceService.ts 拆分，R04-001 文件行数治理）
 */

import { getApiSecret } from "./backendUrl";

/** 流式 STT 客户端接口 */
export interface STTStreamClient {
  /** 推送 PCM16 16kHz mono 音频块 */
  sendPcm(pcm: Uint8Array): void;
  /** 结束并获取最终转录 */
  finalize(): void;
  /** 放弃本次转录 */
  abort(): void;
  /** 关闭连接 */
  close(): void;
  /** 实时字幕（interim）回调 */
  onInterim(cb: (text: string) => void): void;
  /** 最终转录回调 */
  onFinal(cb: (text: string, segments: unknown[]) => void): void;
  /** 错误回调 */
  onError(cb: (error: Error) => void): void;
}

/**
 * 建立流式 STT 连接（3.4/P1-1）
 * 连接后端 /v1/voice/stt WebSocket 端点，按住说话时实时推 PCM 获得字幕。
 * 字幕与最终转录走同一后端 STTRegistry 链路，消除浏览器 SpeechRecognition 双轨。
 */
export function createSTTStream(options?: {
  language?: string;
  keyterms?: string[];
  providerId?: string;
}): Promise<STTStreamClient> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // 加固部署鉴权专项（2026-08-30）：浏览器 WebSocket API 无法携带自定义 header，
    // 密钥经 Sec-WebSocket-Protocol 子协议（liri-auth-<secret>）传递，不进 URL/日志。
    const secret = getApiSecret();
    const subProtocols = secret ? [`liri-auth-${secret}`] : undefined;
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/v1/voice/stt`,
      subProtocols,
    );

    const interimCbs: Array<(text: string) => void> = [];
    const finalCbs: Array<(text: string, segments: unknown[]) => void> = [];
    const errorCbs: Array<(error: Error) => void> = [];

    let resolved = false;
    let closed = false;

    const cleanup = () => {
      if (!closed) {
        closed = true;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
    };

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "config",
          language: options?.language,
          keyterms: options?.keyterms,
          providerId: options?.providerId,
        }),
      );
      resolved = true;
      resolve({
        sendPcm: (pcm) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
        },
        finalize: () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "finalize" }));
          }
        },
        abort: () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "abort" }));
          }
          cleanup();
        },
        close: cleanup,
        onInterim: (cb) => interimCbs.push(cb),
        onFinal: (cb) => finalCbs.push(cb),
        onError: (cb) => errorCbs.push(cb),
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "interim") {
          interimCbs.forEach((cb) => cb(String(data.text ?? "")));
        } else if (data.type === "final") {
          finalCbs.forEach((cb) =>
            cb(
              String(data.text ?? ""),
              Array.isArray(data.segments) ? data.segments : [],
            ),
          );
        } else if (data.type === "error") {
          errorCbs.forEach((cb) =>
            cb(new Error(String(data.message ?? "流式 STT 错误"))),
          );
        }
      } catch {
        // 非 JSON 消息忽略
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        reject(new Error("流式 STT 连接失败"));
      } else {
        errorCbs.forEach((cb) => cb(new Error("流式 STT 连接错误")));
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        reject(new Error("流式 STT 连接关闭"));
      }
    };
  });
}
