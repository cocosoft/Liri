#!/usr/bin/env python3
"""
sensevoice_worker.py — SenseVoice (sherpa-onnx) 长驻工作进程（语音系统升级 3.9 / P2-5 独立文件化）

stdin/stdout 协议（JSON 行）：
  首行（整包配置）: {"model":"SenseVoiceSmall","device":"cpu","download_root":"..."}
  请求（per-request）: {"id":"req-1","audio_path":"/tmp/1.wav","language":"zh"}
  关闭: {"command":"shutdown"}

stdout：
  就绪: {"status":"ready"}
  成功: {"id":"req-1","status":"ok","text":"...","segments":[...],"language":"zh","duration":2.5}
  失败: {"id":"req-1","status":"error","message":"..."}
"""

import sys
import json
import os
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import soundfile as sf

TARGET_SR = 16000


def resample_audio(audio_data, sample_rate):
    """重采样到 16kHz（SenseVoice 要求）"""
    if sample_rate == TARGET_SR:
        return audio_data
    try:
        from scipy import signal

        duration = len(audio_data) / sample_rate
        target_len = int(duration * TARGET_SR)
        return signal.resample(audio_data, target_len)
    except ImportError:
        ratio = TARGET_SR / sample_rate
        target_len = int(len(audio_data) * ratio)
        indices = (np.arange(target_len) / ratio).astype(int)
        indices = np.clip(indices, 0, len(audio_data) - 1)
        return audio_data[indices]


def build_recognizer(model_name, device, download_root):
    """构建 sherpa-onnx OfflineRecognizer

    sherpa-onnx >= 1.11 推荐使用 OfflineRecognizer.from_sense_voice 类方法
    （旧 OfflineRecognizer(config) 构造已不可用）。
    """
    from sherpa_onnx import OfflineRecognizer

    model_dir = os.path.join(download_root, "sherpa-onnx", model_name)
    os.makedirs(model_dir, exist_ok=True)

    return OfflineRecognizer.from_sense_voice(
        model=os.path.join(model_dir, "model.onnx"),
        tokens=os.path.join(model_dir, "tokens.txt"),
        language="auto",
        use_itn=True,
        provider="cpu" if device == "cpu" else "cuda",
    )


def main():
    config_line = sys.stdin.readline()
    if not config_line:
        return
    config = json.loads(config_line)

    model_name = config.get("model", "SenseVoiceSmall")
    device = config.get("device", "cpu")
    download_root = config.get("download_root", os.path.expanduser("~/.pyapp/data/models"))

    try:
        recognizer = build_recognizer(model_name, device, download_root)
    except Exception as e:
        # 模型未下载时给出友好提示（基于文件存在性判断，避免错误字符串匹配掩盖真实错误）
        model_path = os.path.join(download_root, "sherpa-onnx", model_name, "model.onnx")
        if not os.path.exists(model_path):
            error_msg = (
                f"SenseVoice 模型未找到。请手动下载 model.int8.onnx 到: "
                f"{model_path}\n"
                f"官方下载: https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17\n"
                f"国内镜像: https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
            )
        else:
            error_msg = f"SenseVoice 模型加载失败（模型文件存在但初始化报错）: {e}"
        sys.stdout.write(json.dumps({"status": "error", "message": error_msg}) + "\n")
        sys.stdout.flush()
        return

    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request = {}
        try:
            request = json.loads(line)
            if request.get("command") == "shutdown":
                break

            audio_path = request["audio_path"]
            audio_data, sample_rate = sf.read(audio_path)

            # 多声道转单声道
            if audio_data.ndim > 1:
                audio_data = audio_data.mean(axis=1)

            if sample_rate != TARGET_SR:
                audio_data = resample_audio(audio_data, sample_rate)

            # 转为 float32（sherpa-onnx 要求）
            audio_data = audio_data.astype(np.float32)

            # 创建流式识别
            stream = recognizer.create_stream()
            stream.accept_waveform(TARGET_SR, audio_data)
            recognizer.decode_stream(stream)

            result_text = stream.result.text
            segments = []

            # SenseVoice 支持时间戳时有 tokens 信息
            if hasattr(stream.result, "tokens") and stream.result.tokens:
                start_time = 0.0
                for token in stream.result.tokens:
                    segments.append(
                        {
                            "text": token,
                            "start": start_time,
                            "end": start_time + 0.3,
                            "confidence": 0.9,
                        }
                    )
                    start_time += 0.3

            duration = len(audio_data) / TARGET_SR

            result = {
                "id": request.get("id", "unknown"),
                "status": "ok",
                "text": result_text.strip(),
                "segments": segments,
                "language": request.get("language", "zh"),
                "duration": duration,
            }
            sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
            sys.stdout.flush()

        except Exception as e:
            import traceback

            error_result = {
                "id": request.get("id", "unknown"),
                "status": "error",
                "message": str(e),
            }
            sys.stdout.write(json.dumps(error_result) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
