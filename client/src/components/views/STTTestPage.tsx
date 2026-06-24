import { useState, useRef, useCallback, useEffect } from "react";
import { voiceService, type STTResult } from "../../services/voiceService";

/**
 * 获取浏览器支持的录音 MIME type
 * 按优先级探测，都不支持时返回空字符串（由 MediaRecorder 自行决定）
 */
const getSupportedMimeType = (): string => {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
  ];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
};

/** 转录历史记录 */
interface HistoryItem {
  id: string;
  timestamp: number;
  providerId: string;
  language: string;
  audioName: string;
  text: string;
  confidence: number;
  result: STTResult;
}

const MAX_HISTORY = 50;

/**
 * STT 语音识别测试页面
 * 提供录音和文件上传两种输入方式，调用后端 STT 提供者进行语音转文字测试
 */
function STTTestPage() {

  const [isRecording, setIsRecording] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("local");
  const [language, setLanguage] = useState("zh-CN");
  const [keyterms, setKeyterms] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<STTResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  // S3.3: 处理计时器
  const [elapsed, setElapsed] = useState(0);
  // S2.2: 转录历史记录
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // S2.4: 输入模式（录音/上传）
  const [inputMode, setInputMode] = useState<"record" | "upload">("record");
  // S2.6: 麦克风设备
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // S2.6: 麦克风设备选择
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  // S1.3: 录音电平指示
  const [level, setLevel] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  // S3.4: 播放速度
  const [playbackRate, setPlaybackRate] = useState(1);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // S1.3: 音频分析器
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  // S3.3: 处理计时器
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // S2.1: 一键测试自动转录标记
  const autoTranscribeRef = useRef(false);
  // S3.4: 音频播放器 ref（用于控制播放速度）
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);


  /**
   * 开始录音
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setResult(null);
      audioChunksRef.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      });

      // S1.3: 创建音频分析器（用于电平指示）
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      source.connect(analyserNode);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyserNode;

      const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
      const updateLevel = () => {
        analyserNode.getByteFrequencyData(dataArray);
        const avg = Array.from(dataArray).reduce((a, b) => a + b, 0) / dataArray.length;
        setLevel(avg / 255);
        setRecordingTime((prev) => prev + 0.1);
        rafRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const mimeType = getSupportedMimeType();
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType || "audio/webm",
        });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioFile(
          new File([audioBlob], "recording." + ext, { type: mimeType || "audio/webm" }),
        );

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError(
        "无法访问麦克风：" + (err instanceof Error ? err.message : "未知错误"),
      );
    }
  }, [selectedDeviceId]);

  /**
   * 停止录音
   */
  const stopRecording = useCallback(() => {
    // S1.3: 停止电平指示
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
    setRecordingTime(0);

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  /**
   * 处理文件上传
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      setResult(null);

      const file = e.target.files?.[0];
      if (!file) return;

      setAudioFile(file);

      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    },
    [],
  );

  /**
   * 执行语音转录
   */
  const handleTranscribe = useCallback(async () => {
    if (!audioFile) {
      setError("请先录音或选择音频文件");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    // S3.3: 启动处理计时器
    setElapsed(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const parsedKeyterms = keyterms
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const sttResult = await voiceService.transcribe(audioFile, {
        providerId: providerId || undefined,
        language: language || undefined,
        keyterms: parsedKeyterms.length > 0 ? parsedKeyterms : undefined,
      });

      setResult(sttResult);

      // S2.2: 添加到历史记录
      const histItem: HistoryItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        providerId: providerId || "default",
        language: language || "auto",
        audioName: audioFile.name || "录音",
        text: sttResult.text || "",
        confidence: sttResult.confidence || 0,
        result: sttResult,
      };
      setHistory((prev) => [histItem, ...prev].slice(0, MAX_HISTORY));
    } catch (err) {
      setError(
        "转录失败：" + (err instanceof Error ? err.message : "未知错误"),
      );
    } finally {
      setIsProcessing(false);
      // S3.3: 停止处理计时器
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  }, [audioFile, providerId, language, keyterms]);

  /**
   * 清除当前结果
   */
  // S3.2: 清除所有状态（全面清理）
  const handleClear = useCallback(() => {
    setResult(null);
    setError(null);
    setAudioFile(null);
    setIsProcessing(false);

    // S2.5: 关闭 WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    // S3.2: 停止录音
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    // S4.2: 释放 Blob URL
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    // S1.3: 清理音频分析器
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
    setRecordingTime(0);

    // S3.3: 停止计时器
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setElapsed(0);
  }, []);

  // S1.3: 组件卸载时清理音频资源
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // S2.2: 初始化时从 sessionStorage 恢复历史记录
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("stt_history");
      if (saved) {
        const parsed = JSON.parse(saved) as HistoryItem[];
        setHistory(parsed.slice(0, MAX_HISTORY));
      }
    } catch {
      // sessionStorage 数据损坏，静默忽略
    }
  }, []);

  // S2.2: 历史记录变更时持久化到 sessionStorage
  useEffect(() => {
    if (history.length === 0) return;
    try {
      sessionStorage.setItem("stt_history", JSON.stringify(history));
    } catch {
      console.warn("STT 历史记录存储失败，超出 sessionStorage 上限");
    }
  }, [history]);

  // S2.1: 一键测试 — 录音完成后自动触发转录
  useEffect(() => {
    if (autoTranscribeRef.current && audioFile) {
      autoTranscribeRef.current = false;
      handleTranscribe();
    }
  }, [audioFile]);  // eslint-disable-line react-hooks/exhaustive-deps

  // S2.6: 页面加载时枚举麦克风设备
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then((devs) => setDevices(devs.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }, []);

  // S1.1: 页面加载时拉取可用提供者列表
  useEffect(() => {
    voiceService.getProviders()
      .then((list) => setProviders(list.map((p) => p)))
      .catch(() => setProviders(["local", "cloud", "stream"]));
  }, []);

  // S3.4: 同步播放速度到 audio 元素
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border bg-white border-gray-300 text-gray-700 placeholder-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500`;

  const labelClass = `block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300`;

  return (
    <div
      className={`flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold text-gray-900 dark:text-gray-100`}
            >
              STT 语音识别测试
            </h1>
            <p
              className={`mt-1 text-sm text-gray-500 dark:text-gray-400`}
            >
              测试语音转文字功能，选择音频来源和转录选项
            </p>
          </div>
        </div>

        {/* S2.1: 一键测试工具栏 */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">快捷操作:</span>
          <button
            onClick={() => {
              if (!isRecording) startRecording();
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            录音并转录
          </button>
          <button
            onClick={() => {
              if (audioFile) handleTranscribe();
              else setError("请先选择音频文件");
            }}
            disabled={!audioFile}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              audioFile
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400"
            }`}
          >
            转录当前文件
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-xs rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 dark:border-gray-600 transition-colors"
          >
            清除
          </button>
        </div>

        {error && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border dark:border-red-800`}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div
              className={`rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-5`}
            >
              <h2
                className={`text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200`}
              >
                音频输入
              </h2>

              {/* S2.4: 输入模式切换 */}
              <div className="flex mb-4 border-b border-gray-200 dark:border-gray-700">
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    inputMode === "record"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  }`}
                  onClick={() => setInputMode("record")}
                >
                  录音输入
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    inputMode === "upload"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  }`}
                  onClick={() => setInputMode("upload")}
                >
                  上传文件
                </button>
              </div>

              {/* S2.6: 麦克风设备选择 */}
              {devices.length > 0 && inputMode === "record" && (
                <div className="mb-4">
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">麦克风设备</label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border bg-white border-gray-300 text-gray-700 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">默认设备</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `麦克风 (${d.deviceId.slice(0, 8)}...)`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* S1.3: 录音电平指示器 */}
              {isRecording && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">录音电平</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{recordingTime.toFixed(1)}s</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-100"
                      style={{
                        width: `${Math.min(level * 100, 100)}%`,
                        background: level > 0.7
                          ? "linear-gradient(90deg, #22c55e, #eab308, #ef4444)"
                          : "linear-gradient(90deg, #22c55e, #eab308)",
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-gray-400 dark:text-gray-500">静音</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">最大</span>
                  </div>
                </div>
              )}

              {/* S3.1: 拖拽上传区域 — 包裹按钮组 */}
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith("audio/")) {
                    setAudioFile(file);
                    setAudioUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return URL.createObjectURL(file);
                    });
                  }
                }}
                className={`rounded-lg border-2 border-dashed p-1 transition-colors ${
                  !isRecording && !audioFile
                    ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/10"
                    : "border-transparent"
                }`}
              >
              <div className="flex items-center gap-4 mb-4">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isRecording
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                  }`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {isRecording ? (
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    ) : (
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    )}
                  </svg>
                  {isRecording ? "停止录音" : "开始录音"}
                </button>

                <span
                  className={`text-sm text-gray-500 dark:text-gray-400`}
                >
                  或
                </span>

                <label
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 dark:border dark:border-gray-600`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
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
                <div
                  className={`p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                >
                  <p
                    className={`text-xs mb-2 text-gray-500 dark:text-gray-400`}
                  >
                    已选择：{audioFile?.name || "录音文件"} (
                    {audioFile?.size ? (audioFile.size / 1024).toFixed(1) : 0}{" "}
                    KB)
                  </p>
                  <audio ref={audioRef} src={audioUrl} controls className="w-full h-8" />
                  {/* S3.4: 播放速度控制 */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">播放速度:</span>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <button
                        key={speed}
                        onClick={() => setPlaybackRate(speed)}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          playbackRate === speed
                            ? "bg-blue-500 text-white"
                            : "bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500"
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
              </div>  {/* S3.1: drag-drop wrap end */}
            </div>

            <div
              className={`rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-5`}
            >
              <h2
                className={`text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200`}
              >
                转录选项
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>提供者 ID</label>
                  <select
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    className={inputClass}
                  >
                    {providers.map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>语言代码</label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    list="languages"
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
                      ? "bg-gray-400 cursor-not-allowed text-gray-200"
                      : "bg-green-500 hover:bg-green-600 text-white dark:bg-green-600 dark:hover:bg-green-700 dark:text-white"
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <svg
                        className="animate-spin w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      转录中... {elapsed}s
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      执行转录
                    </>
                  )}
                </button>

                <button
                  onClick={handleClear}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 dark:border dark:border-gray-600`}
                >
                  清除
                </button>
              </div>
            </div>

            {result && (
              <div
                className={`rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-5`}
              >
                <h2
                  className={`text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200`}
                >
                  转录结果
                </h2>

                <div
                  className={`p-4 rounded-lg mb-4 text-base leading-relaxed bg-blue-50 text-gray-900 dark:bg-gray-700/50 dark:text-gray-100`}
                >
                  {result.text || (
                    <div>
                      <p className={"text-gray-400 dark:text-gray-500"}>
                        无识别结果
                      </p>
                      {result.status && (
                        <p
                          className={`mt-2 text-xs text-yellow-600 dark:text-yellow-400`}
                        >
                          {result.status}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div
                    className={`p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                  >
                    <p
                      className={`text-xs text-gray-500 dark:text-gray-400`}
                    >
                      置信度
                    </p>
                    <p
                      className={`text-lg font-semibold text-gray-900 dark:text-gray-100`}
                    >
                      {result.confidence
                        ? (result.confidence * 100).toFixed(1) + "%"
                        : "--"}
                    </p>
                  </div>

                  <div
                    className={`p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                  >
                    <p
                      className={`text-xs text-gray-500 dark:text-gray-400`}
                    >
                      处理耗时
                    </p>
                    <p
                      className={`text-lg font-semibold text-gray-900 dark:text-gray-100`}
                    >
                      {result.timing ? result.timing.elapsed + " ms" : "--"}
                    </p>
                  </div>

                  <div
                    className={`p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                  >
                    <p
                      className={`text-xs text-gray-500 dark:text-gray-400`}
                    >
                      音频时长
                    </p>
                    <p
                      className={`text-lg font-semibold text-gray-900 dark:text-gray-100`}
                    >
                      {result.duration
                        ? result.duration.toFixed(1) + "s"
                        : "--"}
                    </p>
                  </div>

                  <div
                    className={`p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                  >
                    <p
                      className={`text-xs text-gray-500 dark:text-gray-400`}
                    >
                      检测语言
                    </p>
                    <p
                      className={`text-lg font-semibold text-gray-900 dark:text-gray-100`}
                    >
                      {result.language || "--"}
                    </p>
                  </div>
                </div>

                {result.provider && (
                  <div
                    className={`mt-3 p-3 rounded-lg bg-gray-100 dark:bg-gray-700/50`}
                  >
                    <p
                      className={`text-xs text-gray-500 dark:text-gray-400`}
                    >
                      提供者
                    </p>
                    <p
                      className={`text-sm font-medium text-gray-800 dark:text-gray-200`}
                    >
                      {result.provider.name} ({result.provider.id}) —{" "}
                      {result.provider.type}
                    </p>
                  </div>
                )}

                <details className="mt-3">
                  <summary
                    className={`text-xs cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300`}
                  >
                    查看原始 JSON
                  </summary>
                  <pre
                    className={`mt-2 p-3 rounded-lg text-xs overflow-auto max-h-60 bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300`}
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* S2.2: 转录历史记录 */}
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  历史记录
                </h2>
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory([])}
                    className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                  >
                    清空
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                  暂无历史记录
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      onClick={() => setResult(item.result)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
                          {item.audioName}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                        {item.text || "无识别结果"}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {item.providerId}
                        </span>
                        {item.confidence > 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {(item.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default STTTestPage;
