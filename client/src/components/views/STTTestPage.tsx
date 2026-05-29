import { useState, useRef, useCallback } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { voiceService, type STTResult } from '../../services/voiceService';

/**
 * STT 语音识别测试页面
 * 提供录音和文件上传两种输入方式，调用后端 STT 提供者进行语音转文字测试
 */
function STTTestPage() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';

  const [isRecording, setIsRecording] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [providerId, setProviderId] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [keyterms, setKeyterms] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<STTResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  /**
   * 开始录音
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setResult(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioFile(new File([audioBlob], 'recording.webm', { type: 'audio/webm' }));

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('无法访问麦克风：' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, []);

  /**
   * 停止录音
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  /**
   * 处理文件上传
   */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setResult(null);

    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(URL.createObjectURL(file));
  }, [audioUrl]);

  /**
   * 执行语音转录
   */
  const handleTranscribe = useCallback(async () => {
    if (!audioFile) {
      setError('请先录音或选择音频文件');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const parsedKeyterms = keyterms
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const sttResult = await voiceService.transcribe(audioFile, {
        providerId: providerId || undefined,
        language: language || undefined,
        keyterms: parsedKeyterms.length > 0 ? parsedKeyterms : undefined,
      });

      setResult(sttResult);
    } catch (err) {
      setError('转录失败：' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsProcessing(false);
    }
  }, [audioFile, providerId, language, keyterms]);

  /**
   * 清除当前结果
   */
  const handleClear = useCallback(() => {
    setResult(null);
    setError(null);
    setAudioFile(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl]);

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border ${
    isDark
      ? 'bg-gray-800 border-gray-600 text-gray-300 placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400'
  } focus:outline-none focus:ring-2 focus:ring-blue-500`;

  const labelClass = `block text-sm font-medium mb-1 ${
    isDark ? 'text-gray-300' : 'text-gray-700'
  }`;

  return (
    <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
              STT 语音识别测试
            </h1>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              测试语音转文字功能，选择音频来源和转录选项
            </p>
          </div>
        </div>

        {error && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            isDark ? 'bg-red-900/30 text-red-400 border border-red-800' : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-5`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                音频输入
              </h2>

              <div className="flex items-center gap-4 mb-4">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : isDark
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    {isRecording ? (
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    ) : (
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    )}
                  </svg>
                  {isRecording ? '停止录音' : '开始录音'}
                </button>

                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  或
                </span>

                <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  isDark
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                }`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  选择音频文件
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {audioUrl && (
                <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                  <p className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    已选择：{audioFile?.name || '录音文件'} ({(audioFile?.size ? (audioFile.size / 1024).toFixed(1) : 0)} KB)
                  </p>
                  <audio src={audioUrl} controls className="w-full h-8" />
                </div>
              )}
            </div>

            <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-5`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                转录选项
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>提供者 ID</label>
                  <input
                    type="text"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    placeholder="留空使用默认提供者"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>语言代码</label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="zh-CN, en-US"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className={labelClass}>关键词提示（逗号分隔）</label>
                <input
                  type="text"
                  value={keyterms}
                  onChange={(e) => setKeyterms(e.target.value)}
                  placeholder="例如：机器学习, 人工智能, API"
                  className={inputClass}
                />
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleTranscribe}
                  disabled={!audioFile || isProcessing}
                  className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    !audioFile || isProcessing
                      ? 'bg-gray-400 cursor-not-allowed text-gray-200'
                      : isDark
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      转录中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      执行转录
                    </>
                  )}
                </button>

                <button
                  onClick={handleClear}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isDark
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300'
                  }`}
                >
                  清除
                </button>
              </div>
            </div>

            {result && (
              <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-5`}>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  转录结果
                </h2>

                <div className={`p-4 rounded-lg mb-4 text-base leading-relaxed ${
                  isDark ? 'bg-gray-700/50 text-gray-100' : 'bg-blue-50 text-gray-900'
                }`}>
                  {result.text || (
                    <div>
                      <p className={isDark ? 'text-gray-500' : 'text-gray-400'}>无识别结果</p>
                      {result.status && (
                        <p className={`mt-2 text-xs ${
                          isDark ? 'text-yellow-400' : 'text-yellow-600'
                        }`}>
                          {result.status}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>置信度</p>
                    <p className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {result.confidence ? (result.confidence * 100).toFixed(1) + '%' : '--'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>处理耗时</p>
                    <p className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {result.timing ? result.timing.elapsed + ' ms' : '--'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>音频时长</p>
                    <p className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {result.duration ? result.duration.toFixed(1) + 's' : '--'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>检测语言</p>
                    <p className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {result.language || '--'}
                    </p>
                  </div>
                </div>

                {result.provider && (
                  <div className={`mt-3 p-3 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>提供者</p>
                    <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {result.provider.name} ({result.provider.id}) — {result.provider.type}
                    </p>
                  </div>
                )}

                <details className="mt-3">
                  <summary className={`text-xs cursor-pointer ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}>
                    查看原始 JSON
                  </summary>
                  <pre className={`mt-2 p-3 rounded-lg text-xs overflow-auto max-h-60 ${
                    isDark ? 'bg-gray-900 text-gray-300' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-5`}>
              <h2 className={`text-lg font-semibold mb-3 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                帮助信息
              </h2>

              <div className={`text-sm space-y-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                <div>
                  <p className="font-medium mb-1">使用说明</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>点击「开始录音」或选择音频文件</li>
                    <li>可选：指定提供者 ID 和语言</li>
                    <li>点击「执行转录」发送到后端</li>
                    <li>查看识别结果和性能指标</li>
                  </ol>
                </div>

                <div>
                  <p className="font-medium mb-1">支持格式</p>
                  <p className="text-xs">WAV、MP3、WebM 等常见音频格式</p>
                </div>

                <div>
                  <p className="font-medium mb-1">提供者 ID</p>
                  <p className="text-xs">
                    目前支持的提供者：<code className={isDark ? 'text-blue-400' : 'text-blue-600'}>local</code>（本地）、<code className={isDark ? 'text-blue-400' : 'text-blue-600'}>cloud</code>（云端）、<code className={isDark ? 'text-blue-400' : 'text-blue-600'}>stream</code>（流式）
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default STTTestPage;
