/**
 * voice-handlers.ts — 语音相关 HTTP handler
 *
 * 从 LocalHTTPService.ts 提取的内联语音处理器，
 * 包含 STT 转写、TTS 合成、语音会话管理等。
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { sendError, readRequestBody } from './handler-utils';
import { configManager } from '@modules/config';

// ========== STT / Voice Handlers ==========

/**
 * 处理语音转文字请求 POST /v1/voice/transcribe
 */
export async function handleSTTTranscribe(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { audioData, providerId, language, keyterms } = JSON.parse(body);

    if (!audioData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'audioData 是必需的（base64 编码的音频数据）' },
        })
      );
      return;
    }

    const audioBuffer = Buffer.from(audioData, 'base64');

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
      ? providers.find((p: any) => p.id === providerId)
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
    const { createVoiceService } = await import('@modules/services/voice');
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

    const { createVoiceService } = await import('@modules/services/voice');
    const voiceService = createVoiceService();
    voiceService.updateConfig({
      language:
        settings.config?.inputLanguage || settings.config?.outputLanguage,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, config: settings.config }));
  } catch (err) {
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
    const sessionId = `voice-${Date.now()}-${randomUUID()}`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: sessionId,
        startedAt: Date.now(),
        endedAt: null,
        duration: null,
        transcript: '',
        responseAudioUrl: null,
        status: 'active',
      })
    );
  } catch (err) {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: sessionId,
        startedAt: Date.now() - 60000,
        endedAt: Date.now(),
        duration: 60000,
        transcript: '',
        responseAudioUrl: null,
        status: 'completed',
      })
    );
  } catch (err) {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        sessions: [],
        total: 0,
      })
    );
  } catch (err) {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: sessionId,
        startedAt: Date.now() - 60000,
        endedAt: null,
        duration: null,
        transcript: '',
        responseAudioUrl: null,
        status: 'active',
      })
    );
  } catch (err) {
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
    sendError(res, err);
  }
}

/**
 * 处理TTS语音合成请求 POST /v1/voice/tts
 */
export async function handleTTSSynthesize(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { text, voiceId } = JSON.parse(body);

    const { TTSRegistry, EdgeTTSProvider } =
      await import('@modules/services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    const result = await TTSRegistry.speak({
      text,
      voice: voiceId || 'zh-CN-XiaoxiaoNeural',
    });

    if (result.success && result.audioData) {
      const audioBase64 = result.audioData.toString('base64');
      const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audioUrl }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: result.error || 'TTS synthesis failed',
        })
      );
    }
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理列出语音提供商请求 GET /v1/voice/providers
 */
export async function handleListVoiceProviders(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(['gemini', 'openai', 'webapi']));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理列出语音列表请求 GET /v1/voice/voices
 */
export async function handleListVoices(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { TTSRegistry, EdgeTTSProvider } =
      await import('@modules/services/voice/services/ttsProvider');

    if (TTSRegistry.getProviderNames().length === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    const ttsProvider = TTSRegistry.getProvider();
    const voices = ttsProvider ? ttsProvider.getVoices() : [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(voices));
  } catch (err) {
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
    sendError(res, err);
  }
}
