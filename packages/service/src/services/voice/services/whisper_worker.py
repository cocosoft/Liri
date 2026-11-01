#!/usr/bin/env python3
"""
whisper_worker.py — faster-whisper 长驻工作进程（语音系统升级 3.9 / P2-5 独立文件化）

stdin 协议（3.2/P1-2）：
  首行（整包配置，JSON 一行）: {"model":"base","device":"cpu","compute_type":"int8","beam_size":5,"vad_filter":true,"vad_min_silence_ms":500,"pid":12345}
  请求（protocol=2，二进制直传）: {"id":"req-1","protocol":2,"audio_len":<bytes>,"sample_rate":16000,"channels":1,"language":"en","initial_prompt":"..."}
    后接 audio_len 字节的原始 PCM16 little-endian 二进制体（无任何容器头）
  请求（protocol=1，audio_path 兼容分支）: {"id":"req-1","audio_path":"/tmp/1.wav","language":"en","initial_prompt":"..."}
  关闭: {"command":"shutdown"}

stdout 协议（JSON 一行，流式一次定义）：
  就绪: {"status":"ready","pid":12345}
  流式中间结果（未来流式消费）: {"id":"req-1","type":"chunk","text":"...","segments":[...]}
  成功（最终）: {"id":"req-1","status":"ok","type":"finalize","text":"...","segments":[...],"language":"en","duration":2.5}
  失败: {"id":"req-1","status":"error","type":"error","message":"..."}
"""

import sys
import json

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

TARGET_SR = 16000
PROTOCOL_BINARY = 2  # 3.2/P1-2: 首行 JSON 头 + 原始 PCM 二进制体


def read_line_bytes():
    """从 stdin.buffer 读取一行（以 \\n 结尾），返回 bytes"""
    buf = bytearray()
    while True:
        b = sys.stdin.buffer.read(1)
        if not b or b == b"\n":
            break
        buf.append(b[0])
    return bytes(buf)


def read_exact(n):
    """从 stdin.buffer 精确读取 n 字节"""
    chunks = bytearray()
    remaining = n
    while remaining > 0:
        chunk = sys.stdin.buffer.read(remaining)
        if not chunk:
            break
        chunks.extend(chunk)
        remaining -= len(chunk)
    return bytes(chunks)


def pcm16_to_float32(raw):
    """PCM16 little-endian 原始字节 → float32 numpy 数组（faster-whisper 输入格式）"""
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def resample_audio(audio_data, sample_rate):
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


def main():
    config_line = read_line_bytes()
    if not config_line:
        return
    config = json.loads(config_line.decode("utf-8"))

    # 从 init config 读取全量配置作为全局默认值
    beam_size = config.get("beam_size", 5)
    vad_filter = config.get("vad_filter", True)
    vad_min_silence_ms = config.get("vad_min_silence_ms", 500)

    model = WhisperModel(
        config["model"],
        device=config["device"],
        compute_type=config["compute_type"],
        download_root=config.get("download_root"),
    )

    sys.stdout.write(json.dumps({"status": "ready", "pid": config.get("pid", 0)}) + "\n")
    sys.stdout.flush()

    while True:
        header = read_line_bytes()
        if not header:
            break

        request = {}
        try:
            request = json.loads(header.decode("utf-8"))
            if request.get("command") == "shutdown":
                break

            protocol = int(request.get("protocol", 1))
            if protocol >= PROTOCOL_BINARY:
                # 3.2/P1-2: 二进制直传（无临时文件、无 base64 膨胀）
                audio_len = int(request["audio_len"])
                raw = read_exact(audio_len)
                audio_data = pcm16_to_float32(raw)
                sample_rate = int(request.get("sample_rate", TARGET_SR))
            else:
                # 兼容分支（protocol=1）：旧式 audio_path（worker 与 TS 侧版本不匹配时）
                audio_path = request["audio_path"]
                audio_data, sample_rate = sf.read(audio_path)

            if sample_rate != TARGET_SR:
                audio_data = resample_audio(audio_data, sample_rate)

            segments, info = model.transcribe(
                audio_data,
                language=request.get("language", "en"),
                beam_size=request.get("beam_size", beam_size),
                initial_prompt=request.get("initial_prompt"),
                vad_filter=request.get("vad_filter", vad_filter),
                vad_parameters=dict(
                    min_silence_duration_ms=request.get(
                        "vad_min_silence_ms", vad_min_silence_ms
                    )
                ),
            )

            seg_list = []
            text_parts = []
            for seg in segments:
                seg_list.append(
                    {
                        "text": seg.text,
                        "start": seg.start,
                        "end": seg.end,
                        "confidence": getattr(seg, "avg_logprob", 0),
                    }
                )
                text_parts.append(seg.text)

            # 流式协议一次定义：chunk 留给流式消费，本次非流式直接发 finalize
            result = {
                "id": request.get("id", "unknown"),
                "status": "ok",
                "type": "finalize",
                "text": " ".join(text_parts),
                "segments": seg_list,
                "language": info.language,
                "duration": info.duration,
            }
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()

        except Exception as e:
            error_result = {
                "id": request.get("id", "unknown"),
                "status": "error",
                "type": "error",
                "message": str(e),
            }
            sys.stdout.write(json.dumps(error_result) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
