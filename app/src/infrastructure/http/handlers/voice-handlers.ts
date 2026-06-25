/**
 * voice-handlers.ts — 语音相关 HTTP handler
 *
 * 从 LocalHTTPService.ts 提取的内联语音处理器，
 * 包含 STT 转写、TTS 合成、语音会话管理等。
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  sendError,
  readRequestBody,
  readRawBody,
  parseMultipartBody,
} from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

// ========== 语音会话内存存储 ==========

/** 语音会话信息 */
interface VoiceSessionInfo {
  id: string;
  startedAt: number;
  endedAt: number | null;
  duration: number | null;
  transcript: string;
  responseAudioUrl: string | null;
  status: 'active' | 'completed' | 'failed';
}

/** 语音会话内存存储（进程级，服务重启后重置） */
const voiceSessions = new Map<string, VoiceSessionInfo>();

// ========== STT / Voice Handlers ==========

/**
 * 处理语音转文字请求 POST /v1/voice/transcribe
 *
 * 同时支持：
 * - JSON + base64（Content-Type: application/json）：{ audioData (base64), ... }
 * - multipart/form-data（Content-Type: multipart/form-data）：audio 文件 + 文本字段
 */
export async function handleSTTTranscribe(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const contentType = req.headers['content-type'] || '';
    const isMultipart = contentType.startsWith('multipart/form-data');

    let audioBuffer: Buffer;
    let providerId: string | undefined;
    let language: string | undefined;
    let keyterms: string[] | undefined;

    if (isMultipart) {
      // L4/L5: 二进制传输模式 — 解析 multipart/form-data
      const rawBody = await readRawBody(req);
      const parts = parseMultipartBody(rawBody, contentType);

      const audioPart = parts.find((p) => p.name === 'audio');
      if (!audioPart || !Buffer.isBuffer(audioPart.data)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '缺少 audio 文件字段' } }));
        return;
      }
      audioBuffer = audioPart.data;

      const providerField = parts.find((p) => p.name === 'providerId');
      if (providerField && typeof providerField.data === 'string') {
        providerId = providerField.data;
      }

      const langField = parts.find((p) => p.name === 'language');
      if (langField && typeof langField.data === 'string') {
        language = langField.data;
      }

      const keytermsField = parts.find((p) => p.name === 'keyterms');
      if (keytermsField && typeof keytermsField.data === 'string') {
        try {
          keyterms = JSON.parse(keytermsField.data);
        } catch {
          keyterms = [keytermsField.data];
        }
      }
    } else {
      // 兼容模式：JSON + base64
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body);

      if (!parsed.audioData) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'audioData 是必需的（base64 编码的音频数据）' },
          })
        );
        return;
      }

      audioBuffer = Buffer.from(parsed.audioData, 'base64');
      providerId = parsed.providerId;
      language = parsed.language;
      keyterms = parsed.keyterms
        ? Array.isArray(parsed.keyterms)
          ? parsed.keyterms
          : [parsed.keyterms]
        : undefined;
    }

    if (audioBuffer.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '音频数据为空' } }));
      return;
    }

    const { STTRegistry } =
      await import('../../../services/voice/services/sttRegistry');

    // 自动注册 STT 提供者（如尚未注册）
    if (STTRegistry.getAllProviders().length === 0) {
      const { LocalSTTProvider } =
        await import('../../../services/voice/services/localSTTProvider');
      STTRegistry.register(new LocalSTTProvider());

      const openAIApiKey = configManager.env('OPENAI_API_KEY');
      if (openAIApiKey) {
        const { CloudSTTProvider } =
          await import('../../../services/voice/services/cloudSTTProvider');
        STTRegistry.register(new CloudSTTProvider({ apiKey: openAIApiKey }));
      }
    }

    const startTime = Date.now();

    // providerId 是 STTRegistry.transcribe 的第三个独立参数
    const result = await STTRegistry.transcribe(
      audioBuffer,
      {
        language: language,
        keyterms: keyterms
          ? Array.isArray(keyterms)
            ? keyterms
            : [keyterms]
          : undefined,
      },
      providerId || undefined
    );

    const elapsed = Date.now() - startTime;

    const providers = STTRegistry.getAllProviders();
    const activeProvider = providerId
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providers.find((p: any) => p.id === providerId)
      : STTRegistry.getDefaultProvider();

    // 构建详细状态信息
    const status: string[] = [];
    if (!result.text) {
      status.push('识别文本为空');
      if (activeProvider) {
        status.push(
          `提供者 "${activeProvider.name} (${activeProvider.id})" 不可用`
        );
        if (activeProvider.id === 'local') {
          status.push(
            '本地 STT 需要 Python 3.8+ 和 faster-whisper: pip install faster-whisper'
          );
        } else if (activeProvider.id === 'cloud') {
          status.push('云端 STT 需要配置 OpenAI API 密钥');
        } else if (activeProvider.id === 'stream') {
          status.push('流式 STT 需要配置 WebSocket 端点');
        }
      } else {
        status.push('没有已注册且可用的 STT 提供者');
        status.push(
          '请安装 faster-whisper（pip install faster-whisper）或配置云端/流式 STT 提供者'
        );
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        text: result.text,
        confidence: result.confidence,
        isFinal: result.isFinal,
        duration: result.duration,
        language: result.language,
        segments: result.segments,
        timing: {
          elapsed,
          unit: 'ms',
        },
        provider: activeProvider
          ? {
              id: activeProvider.id,
              name: activeProvider.name,
              type: activeProvider.type,
              available: activeProvider.isAvailable(),
            }
          : null,
        status: status.length > 0 ? status.join('；') : undefined,
      })
    );
  } catch (err) {
    logger.error('STT 转写失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'stt_transcribe' });
    sendError(res, err);
  }
}

/**
 * 处理获取语音设置请求 GET /v1/voice/settings
 */
export async function handleGetVoiceSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { createVoiceService } = await import('../../../services/voice');
    const voiceService = createVoiceService();
    const config = voiceService.getConfig();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        config: {
          provider: 'default',
          inputDeviceId: undefined,
          outputDeviceId: undefined,
          wakeWordEnabled: false,
          wakeWord: '你好',
          autoPlayTTS: true,
          voiceId: 'zh-CN-XiaoxiaoNeural',
          inputLanguage: config.language || 'zh-CN',
          outputLanguage: config.language || 'zh-CN',
        },
        wakeWords: [],
        hotkeys: {},
      })
    );
  } catch (err) {
    logger.error('获取语音设置失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'get_settings' });
    sendError(res, err);
  }
}

/**
 * 处理更新语音设置请求 PUT /v1/voice/settings
 */
export async function handleUpdateVoiceSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const settings = JSON.parse(body);

    const { createVoiceService } = await import('../../../services/voice');
    const voiceService = createVoiceService();
    voiceService.updateConfig({
      language:
        settings.config?.inputLanguage || settings.config?.outputLanguage,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, config: settings.config }));
  } catch (err) {
    logger.error('更新语音设置失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'update_settings' });
    sendError(res, err);
  }
}

/**
 * 处理开始语音会话请求 POST /v1/voice/session/start
 */
export async function handleStartVoiceSession(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const session: VoiceSessionInfo = {
      id: `voice-${Date.now()}-${randomUUID()}`,
      startedAt: Date.now(),
      endedAt: null,
      duration: null,
      transcript: '',
      responseAudioUrl: null,
      status: 'active',
    };
    voiceSessions.set(session.id, session);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    logger.error('开始语音会话失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'start_session' });
    sendError(res, err);
  }
}

/**
 * 处理结束语音会话请求 POST /v1/voice/session/:id/end
 */
export async function handleEndVoiceSession(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const session = voiceSessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `会话 ${sessionId} 不存在` } })
      );
      return;
    }

    session.endedAt = Date.now();
    session.duration = session.endedAt - session.startedAt;
    session.status = 'completed';
    voiceSessions.set(sessionId, session);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    logger.error('结束语音会话失败', { error: String(err), sessionId });
    void handleError(err, {
      module: 'http:voice',
      action: 'end_session',
      context: { sessionId },
    });
    sendError(res, err);
  }
}

/**
 * 处理列出语音会话请求 GET /v1/voice/sessions
 */
export async function handleListVoiceSessions(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const sessions = Array.from(voiceSessions.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions, total: sessions.length }));
  } catch (err) {
    logger.error('列出语音会话失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'list_sessions' });
    sendError(res, err);
  }
}

/**
 * 处理获取语音会话详情请求 GET /v1/voice/session/:id
 */
export async function handleGetVoiceSession(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const session = voiceSessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `会话 ${sessionId} 不存在` } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    logger.error('获取语音会话详情失败', { error: String(err), sessionId });
    void handleError(err, {
      module: 'http:voice',
      action: 'get_session',
      context: { sessionId },
    });
    sendError(res, err);
  }
}

/**
 * 处理上传音频请求 POST /v1/voice/upload
 */
export async function handleVoiceUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        transcript: '',
        audioUrl: null,
      })
    );
  } catch (err) {
    logger.error('上传音频失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'upload_audio' });
    sendError(res, err);
  }
}

/**
 * 处理获取音频流请求 GET /v1/voice/stream/:id
 */
export async function handleVoiceStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _sessionId: string
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Audio streaming not implemented' }));
  } catch (err) {
    logger.error('获取音频流失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'stream_audio' });
    sendError(res, err);
  }
}

/**
 * 处理TTS语音合成请求 POST /v1/voice/tts
 *
 * 请求体参数：
 *   - text: 合成文本（必需）
 *   - voiceId: 语音 ID（可选）
 *   - provider: TTS 提供者名称（可选，默认使用默认提供者）
 *   - format: 音频格式（可选，如 'mp3', 'wav', 'opus'，仅对支持多格式的 Provider 生效）
 */
export async function handleTTSSynthesize(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { text, voiceId, provider, format } = JSON.parse(body);

    const { TTSRegistry, EdgeTTSProvider } =
      await import('../../../services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    const result = await TTSRegistry.speak(
      {
        text,
        voice: voiceId || 'zh-CN-XiaoxiaoNeural',
        format,
      },
      provider
    );

    if (result.success && result.audioData) {
      const audioFormat = result.audioFormat || 'mp3';
      const audioBase64 = result.audioData.toString('base64');
      const audioUrl = `data:audio/${audioFormat};base64,${audioBase64}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audioUrl, audioFormat }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: result.error || 'TTS synthesis failed',
        })
      );
    }
  } catch (err) {
    logger.error('TTS 合成失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'tts_synthesize' });
    sendError(res, err);
  }
}

/**
 * 处理列出语音提供商请求 GET /v1/voice/providers
 * 从 STTRegistry 动态获取已注册的 STT 提供者列表
 */
export async function handleListVoiceProviders(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { STTRegistry } =
      await import('../../../services/voice/services/sttRegistry');

    // 自动注册默认 STT 提供者（如尚未注册）
    if (STTRegistry.getAllProviders().length === 0) {
      const { LocalSTTProvider } =
        await import('../../../services/voice/services/localSTTProvider');
      STTRegistry.register(new LocalSTTProvider());

      const openAIApiKey = configManager.env('OPENAI_API_KEY');
      if (openAIApiKey) {
        const { CloudSTTProvider } =
          await import('../../../services/voice/services/cloudSTTProvider');
        STTRegistry.register(new CloudSTTProvider({ apiKey: openAIApiKey }));
      }
    }

    const providerIds = STTRegistry.getProviderIds();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(providerIds));
  } catch (err) {
    logger.error('列出语音提供商失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'list_providers' });
    sendError(res, err);
  }
}

/**
 * 处理列出语音列表请求 GET /v1/voice/voices
 *
 * 支持查询参数：
 *   - provider: 指定 TTS 提供者名称（可选，默认使用默认提供者）
 */
export async function handleListVoices(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSRegistry, EdgeTTSProvider } =
      await import('../../../services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    // 解析 provider 查询参数
    const queryStr = req.url?.includes('?')
      ? new URL(req.url, 'http://localhost').searchParams
      : null;
    const providerName = queryStr?.get('provider') || undefined;

    const ttsProvider = TTSRegistry.getProvider(providerName);
    const voices = ttsProvider ? ttsProvider.getVoices() : [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(voices));
  } catch (err) {
    logger.error('列出语音列表失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'list_voices' });
    sendError(res, err);
  }
}

/**
 * 处理测试唤醒词请求 POST /v1/voice/wakeword/:id/test
 */
export async function handleTestWakeWord(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _wakeWordId: string
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detected: false }));
  } catch (err) {
    logger.error('测试唤醒词失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'test_wakeword' });
    sendError(res, err);
  }
}

// ═════════════════════════════════════════════════════════════════
// TTS Provider 管理
// ═════════════════════════════════════════════════════════════════

/**
 * 处理列出 TTS 提供者列表 GET /v1/tts/providers
 *
 * 返回所有已注册 TTS 提供者的名称和其支持的音频格式。
 */
export async function handleListTTSProviders(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSRegistry, EdgeTTSProvider } =
      await import('../../../services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    const providers = TTSRegistry.getProvidersInfo();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(providers));
  } catch (err) {
    logger.error('列出 TTS 提供者失败', { error: String(err) });
    void handleError(err, {
      module: 'http:voice',
      action: 'list_tts_providers',
    });
    sendError(res, err);
  }
}

/**
 * 处理保存 TTS 提供者配置 POST /v1/tts/providers/:name/config
 */
export async function handleSaveProviderConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  providerName: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const config = JSON.parse(body);

    const { TTSRegistry } =
      await import('../../../services/voice/services/ttsProvider');

    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Provider "${providerName}" 未注册` },
        })
      );
      return;
    }

    // 如果 provider 有 updateConfig 方法，调用之
    if (
      typeof (provider as unknown as Record<string, unknown>).updateConfig ===
      'function'
    ) {
      (
        provider as unknown as Record<
          string,
          (config: Record<string, unknown>) => void
        >
      ).updateConfig(config);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    logger.error('保存 TTS 提供者配置失败', {
      error: String(err),
      providerName,
    });
    void handleError(err, {
      module: 'http:voice',
      action: 'save_provider_config',
    });
    sendError(res, err);
  }
}

// ═════════════════════════════════════════════════════════════════
// TTS Persona CRUD
// ═════════════════════════════════════════════════════════════════

/**
 * 处理列出人设列表 GET /v1/tts/personas
 */
export async function handleListPersonas(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const personas = TTSPersonaManager.listDetail();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(personas));
  } catch (err) {
    logger.error('列出人设失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'list_personas' });
    sendError(res, err);
  }
}

/**
 * 处理创建人设 POST /v1/tts/personas
 */
export async function handleCreatePersona(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const options = JSON.parse(body);

    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const persona = TTSPersonaManager.create(options);

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(persona));
  } catch (err) {
    logger.error('创建人设失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'create_persona' });
    sendError(res, err);
  }
}

/**
 * 处理获取单个人设 GET /v1/tts/personas/:id
 */
export async function handleGetPersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const persona = TTSPersonaManager.get(personaId);
    if (!persona) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `人设 "${personaId}" 不存在` } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(persona));
  } catch (err) {
    logger.error('获取人设失败', { error: String(err), personaId });
    void handleError(err, { module: 'http:voice', action: 'get_persona' });
    sendError(res, err);
  }
}

/**
 * 处理更新人设 PUT /v1/tts/personas/:id
 */
export async function handleUpdatePersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const partial = JSON.parse(body);

    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const success = TTSPersonaManager.update(personaId, partial);
    if (!success) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `人设 "${personaId}" 不存在` } })
      );
      return;
    }

    const updated = TTSPersonaManager.get(personaId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    logger.error('更新人设失败', { error: String(err), personaId });
    void handleError(err, { module: 'http:voice', action: 'update_persona' });
    sendError(res, err);
  }
}

/**
 * 处理删除人设 DELETE /v1/tts/personas/:id
 */
export async function handleDeletePersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const success = TTSPersonaManager.delete(personaId);
    if (!success) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `人设 "${personaId}" 不存在` } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    logger.error('删除人设失败', { error: String(err), personaId });
    void handleError(err, { module: 'http:voice', action: 'delete_persona' });
    sendError(res, err);
  }
}

// ═════════════════════════════════════════════════════════════════
// TTS Additional Endpoints
// ═════════════════════════════════════════════════════════════════

/**
 * 处理 TTS 合成别名 POST /v1/tts/synthesize
 * 与 /v1/voice/tts 相同逻辑，提供更语义化的路径
 */
export async function handleTTSSynthesizeAlias(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  await handleTTSSynthesize(req, res);
}

/**
 * 停止当前 TTS 合成 POST /v1/tts/stop
 */
export async function handleTTSStop(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSRegistry } =
      await import('../../../services/voice/services/ttsProvider');

    TTSRegistry.stopAll();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    logger.error('停止 TTS 合成失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'tts_stop' });
    sendError(res, err);
  }
}

/**
 * TTS 健康检测 GET /v1/tts/health
 * 返回各 Provider 状态、熔断器状态
 */
export async function handleTTSHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSRegistry, EdgeTTSProvider } =
      await import('../../../services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    const providerNames = TTSRegistry.getProviderNames();
    const providerInfos = TTSRegistry.getProvidersInfo();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        providers: providerNames,
        providerDetails: providerInfos,
      })
    );
  } catch (err) {
    logger.error('TTS 健康检测失败', { error: String(err) });
    void handleError(err, { module: 'http:voice', action: 'tts_health' });
    sendError(res, err);
  }
}

/**
 * 获取默认人设 GET /v1/tts/personas/default
 */
export async function handleGetDefaultPersona(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const defaultPersona = TTSPersonaManager.getDefault();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(defaultPersona ?? null));
  } catch (err) {
    logger.error('获取默认人设失败', { error: String(err) });
    void handleError(err, {
      module: 'http:voice',
      action: 'get_default_persona',
    });
    sendError(res, err);
  }
}

/**
 * 列出所有人设绑定关系 GET /v1/tts/personas/bindings
 *
 * 返回按 personaId 分组的数据格式，与前端 TTSPersonaManager 期望一致：
 *   [{ personaId: string, agents: [{ agentId: string, agentName: string }] }]
 */
export async function handleListPersonaBindings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const flatBindings = TTSPersonaManager.listBindings();

    // 将扁平绑定关系按 personaId 分组
    const grouped = new Map<
      string,
      Array<{ agentId: string; agentName: string }>
    >();
    for (const { agentId, personaId } of flatBindings) {
      if (!grouped.has(personaId)) {
        grouped.set(personaId, []);
      }
      grouped.get(personaId)!.push({ agentId, agentName: agentId });
    }

    const result = Array.from(grouped.entries()).map(([personaId, agents]) => ({
      personaId,
      agents,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    logger.error('列出人设绑定关系失败', { error: String(err) });
    void handleError(err, {
      module: 'http:voice',
      action: 'list_persona_bindings',
    });
    sendError(res, err);
  }
}

/**
 * 设为默认人设 PUT /v1/tts/personas/:id/default
 */
export async function handleSetDefaultPersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const body = await readRequestBody(req);
    const { setDefault } = JSON.parse(body);
    // setDefault: true 设为默认，false 取消默认

    if (setDefault === false) {
      TTSPersonaManager.setDefault(null);
    } else {
      const success = TTSPersonaManager.setDefault(personaId);
      if (!success) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `人设 "${personaId}" 不存在` } })
        );
        return;
      }
    }

    const updated = TTSPersonaManager.get(personaId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    logger.error('设置默认人设失败', { error: String(err), personaId });
    void handleError(err, {
      module: 'http:voice',
      action: 'set_default_persona',
    });
    sendError(res, err);
  }
}

/**
 * 人设绑定到 Agent PUT /v1/tts/personas/:id/bind
 */
export async function handleBindPersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { agentId } = JSON.parse(body);

    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '缺少必填字段 agentId' } }));
      return;
    }

    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    const success = TTSPersonaManager.bindToAgent(agentId, personaId);
    if (!success) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `人设 "${personaId}" 不存在` } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, agentId, personaId }));
  } catch (err) {
    logger.error('绑定人设到 Agent 失败', { error: String(err), personaId });
    void handleError(err, { module: 'http:voice', action: 'bind_persona' });
    sendError(res, err);
  }
}

/**
 * 人设取消绑定 Agent DELETE /v1/tts/personas/:id/bind
 */
export async function handleUnbindPersona(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  personaId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { agentId } = JSON.parse(body);

    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '缺少必填字段 agentId' } }));
      return;
    }

    const { TTSPersonaManager } =
      await import('../../../services/voice/services/ttsPersonaManager');

    TTSPersonaManager.unbindFromAgent(agentId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, agentId, personaId }));
  } catch (err) {
    logger.error('取消人设绑定失败', { error: String(err), personaId });
    void handleError(err, { module: 'http:voice', action: 'unbind_persona' });
    sendError(res, err);
  }
}
