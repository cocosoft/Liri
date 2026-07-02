"""
vision_worker.py — Liri 视觉分析常驻进程
通过 StdIO (stdin/stdout) 接收 JSON-RPC 请求，每行一个 JSON 消息
协议：换行分隔，`write(json + '\\n')` 发送，`readline()` 读取

用法：python vision_worker.py

支持的模型（按需导入，首次使用时自动 pip install）：
  - colorthief: 主色调提取 (pip install colorthief)
  - Pillow: 图片元数据读取 (pip install Pillow)
  - EasyOCR: 光学字符识别 (pip install easyocr)
  - ultralytics: YOLOv8 目标检测 (pip install ultralytics)
  - CLIP: 图片语义匹配 (pip install open-clip-torch)

消息协议：
  请求：{"id":"req_1","method":"analyze_colors","params":{"image_path":"/path/to/img.png"}}
  响应：{"id":"req_1","success":true,"result":{...}}
  错误：{"id":"req_1","success":false,"error":{"code":"MODEL_ERROR","message":"..."}}
"""

import sys
import json
import traceback
import os

# 确保 stdout 使用 UTF-8 编码（Windows 兼容）
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ---- 模型注册表 ----
# 每个模型定义：check() 检测可用性，ensure() 确保安装
MODELS = {}


def register_model(name, check_fn, install_hint):
    """注册一个可选模型"""
    MODELS[name] = {"check": check_fn, "install_hint": install_hint, "loaded": False}


def ensure_model(name):
    """确保模型已导入，失败则抛出"""
    model = MODELS.get(name)
    if not model:
        raise RuntimeError(f"Unknown model: {name}")
    if model["loaded"]:
        return
    try:
        model["check"]()
        model["loaded"] = True
    except ImportError as e:
        raise RuntimeError(
            f"Model '{name}' is not installed. Install it: {model['install_hint']}"
        ) from e


# ---- 模型: colorthief (主色调提取) ----
def _check_colorthief():
    import colorthief  # noqa: F401


register_model("colorthief", _check_colorthief, "pip install colorthief")

# ---- 模型: Pillow (图片元数据) ----
def _check_pillow():
    from PIL import Image  # noqa: F401


register_model("pillow", _check_pillow, "pip install Pillow")

# ---- 模型: EasyOCR (文字识别) ----
def _check_easyocr():
    import easyocr  # noqa: F401


register_model("easyocr", _check_easyocr, "pip install easyocr")

# ---- 模型: ultralytics/YOLO (目标检测) ----
def _check_ultralytics():
    import ultralytics  # noqa: F401


register_model("ultralytics", _check_ultralytics, "pip install ultralytics")

# ---- 模型: open_clip (语义匹配) ----
def _check_clip():
    import open_clip  # noqa: F401


register_model("open_clip", _check_clip, "pip install open-clip-torch")


# ---------------------------------------------------------------------------
#  命令处理器
# ---------------------------------------------------------------------------

def handle_analyze_colors(params):
    """
    提取图片主色调
    返回：{"palette": [{"r":255,"g":0,"b":0}, ...], "dominant": {"r":255,"g":0,"b":0}}
    """
    ensure_model("colorthief")
    from colorthief import ColorThief

    image_path = params.get("image_path")
    if not image_path:
        return _error("MISSING_PARAM", "image_path is required")
    if not os.path.isfile(image_path):
        return _error("FILE_NOT_FOUND", f"Image not found: {image_path}")

    count = params.get("count", 5)
    ct = ColorThief(image_path)

    # 主色调
    dominant = ct.get_color(quality=1)
    # 调色板
    palette = ct.get_palette(color_count=count, quality=1 if count <= 5 else 10)

    return {
        "palette": [_rgb_dict(c) for c in palette],
        "dominant": _rgb_dict(dominant),
    }


def handle_analyze_metadata(params):
    """
    读取图片元数据
    返回：{"width": 1920, "height": 1080, "format": "JPEG", "file_size": 123456}
    """
    image_path = params.get("image_path")
    if not image_path:
        return _error("MISSING_PARAM", "image_path is required")
    if not os.path.isfile(image_path):
        return _error("FILE_NOT_FOUND", f"Image not found: {image_path}")

    file_size = os.path.getsize(image_path)
    result = {"file_size": file_size}

    try:
        ensure_model("pillow")
        from PIL import Image
        with Image.open(image_path) as img:
            result["width"] = img.width
            result["height"] = img.height
            result["format"] = img.format
            result["mode"] = img.mode
    except Exception:
        # Pillow 失败不影响文件大小信息返回
        result["pillow_available"] = False

    return result


def handle_ocr(params):
    """
    OCR 文字识别
    返回：{"text": "...", "confidence": 0.95, "blocks": [...]}
    """
    ensure_model("easyocr")
    import easyocr

    image_path = params.get("image_path")
    if not image_path:
        return _error("MISSING_PARAM", "image_path is required")
    if not os.path.isfile(image_path):
        return _error("FILE_NOT_FOUND", f"Image not found: {image_path}")

    languages = params.get("languages", ["ch_sim", "en"])
    # EasyOCR Reader 是重量级对象，缓存起来复用
    lang_key = "+".join(sorted(languages))
    reader = _get_cached_easyocr_reader(lang_key, languages)

    results = reader.readtext(image_path)

    blocks = []
    full_text_parts = []
    total_confidence = 0
    for (bbox, text, confidence) in results:
        blocks.append({
            "text": text,
            "confidence": round(float(confidence), 4),
            "bbox": [[int(p[0]), int(p[1])] for p in bbox],
        })
        full_text_parts.append(text)
        total_confidence += confidence

    avg_confidence = (total_confidence / len(results)) if results else 0

    return {
        "text": "\n".join(full_text_parts),
        "confidence": round(float(avg_confidence), 4),
        "blocks": blocks,
        "language": lang_key,
    }


# EasyOCR Reader 缓存
_easyocr_readers = {}

def _get_cached_easyocr_reader(lang_key, languages):
    """获取或创建 EasyOCR Reader（带缓存）"""
    import easyocr
    if lang_key not in _easyocr_readers:
        _easyocr_readers[lang_key] = easyocr.Reader(languages, gpu=False)
    return _easyocr_readers[lang_key]


def handle_object_detection(params):
    """
    YOLO 目标检测
    返回：{"objects": [{"label": "person", "confidence": 0.92, "bbox": [x,y,w,h]}, ...]}
    """
    ensure_model("ultralytics")
    from ultralytics import YOLO

    image_path = params.get("image_path")
    if not image_path:
        return _error("MISSING_PARAM", "image_path is required")
    if not os.path.isfile(image_path):
        return _error("FILE_NOT_FOUND", f"Image not found: {image_path}")

    model_name = params.get("model", "yolov8n")
    # YOLO 模型也缓存复用
    model = _get_cached_yolo_model(model_name)

    results = model(image_path)
    objects = []
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            cls_id = int(box.cls[0].item())
            label = result.names.get(cls_id, f"class_{cls_id}")
            confidence = float(box.conf[0].item())
            xywh = box.xywh[0].tolist()
            objects.append({
                "label": label,
                "confidence": round(confidence, 4),
                "bbox": {
                    "x": round(xywh[0], 2),
                    "y": round(xywh[1], 2),
                    "width": round(xywh[2], 2),
                    "height": round(xywh[3], 2),
                },
            })

    return {
        "objects": objects,
        "count": len(objects),
        "model": model_name,
    }


_yolo_models = {}

def _get_cached_yolo_model(model_name):
    """获取或创建 YOLO 模型（带缓存）"""
    from ultralytics import YOLO
    if model_name not in _yolo_models:
        _yolo_models[model_name] = YOLO(f"{model_name}.pt")
    return _yolo_models[model_name]


def handle_image_similarity(params):
    """
    CLIP 图片语义匹配
    返回：{"similarity": 0.85, "label": "best_match_label"}
    支持两种模式：
      - image vs text：计算图片与文本描述的匹配度
      - image vs image：计算两张图片的语义相似度
    """
    ensure_model("open_clip")
    import open_clip
    import torch
    from PIL import Image

    image_path = params.get("image_path")
    if not image_path:
        return _error("MISSING_PARAM", "image_path is required")
    if not os.path.isfile(image_path):
        return _error("FILE_NOT_FOUND", f"Image not found: {image_path}")

    # 加载 CLIP 模型（缓存）
    model, preprocess, tokenizer = _get_cached_clip_model()

    pil_image = Image.open(image_path).convert("RGB")
    image_input = preprocess(pil_image).unsqueeze(0)

    with torch.no_grad():
        image_features = model.encode_image(image_input)
        image_features /= image_features.norm(dim=-1, keepdim=True)

    # 模式 1: 图片 vs 文本标签列表
    labels = params.get("labels")
    if labels:
        text_tokens = tokenizer(labels)
        with torch.no_grad():
            text_features = model.encode_text(text_tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)

        similarity = (image_features @ text_features.T).squeeze(0)
        best_idx = int(similarity.argmax().item())

        return {
            "similarity": round(float(similarity.max().item()), 4),
            "label": labels[best_idx],
            "all_scores": {label: round(float(score.item()), 4) for label, score in zip(labels, similarity)},
        }

    # 模式 2: 图片 vs 图片
    compare_path = params.get("compare_path")
    if compare_path:
        if not os.path.isfile(compare_path):
            return _error("FILE_NOT_FOUND", f"Compare image not found: {compare_path}")

        compare_image = Image.open(compare_path).convert("RGB")
        compare_input = preprocess(compare_image).unsqueeze(0)

        with torch.no_grad():
            compare_features = model.encode_image(compare_input)
            compare_features /= compare_features.norm(dim=-1, keepdim=True)

        sim = float((image_features @ compare_features.T).item())
        return {
            "similarity": round(sim, 4),
            "mode": "image_vs_image",
        }

    # 模式 3: 图片 vs 单个文本
    text = params.get("text")
    if text:
        text_tokens = tokenizer([text])
        with torch.no_grad():
            text_features = model.encode_text(text_tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)

        sim = float((image_features @ text_features.T).item())
        return {
            "similarity": round(sim, 4),
            "text": text,
            "mode": "image_vs_text",
        }

    return _error("MISSING_PARAM", "Requires 'labels', 'compare_path', or 'text' parameter")


_clip_model_cache = None

def _get_cached_clip_model():
    """获取或创建 CLIP 模型（全局单例缓存）"""
    global _clip_model_cache
    import open_clip
    if _clip_model_cache is None:
        # 使用 ViT-B-32 作为默认模型（轻量、快速）
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        _clip_model_cache = (model, preprocess, tokenizer)
    return _clip_model_cache


def handle_health(_params):
    """健康检查"""
    return {
        "status": "ok",
        "python_version": sys.version,
        "models": list(MODELS.keys()),
        "loaded_models": [name for name, m in MODELS.items() if m["loaded"]],
    }


# ---------------------------------------------------------------------------
#  SAM 分割 & Depth 估计 (P1-7: 高级视觉扩展)
# ---------------------------------------------------------------------------

_sam_predictor = None


def _get_sam_predictor():
    """懒加载 SAM (Segment Anything Model) 预测器"""
    global _sam_predictor
    if _sam_predictor is None:
        _check_module("segment_anything", "segment-anything")
        from segment_anything import sam_model_registry, SamPredictor
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        # 使用轻量级 ViT-B 模型
        model = sam_model_registry["vit_b"]()
        model.to(device)
        _sam_predictor = SamPredictor(model)
    return _sam_predictor


def handle_sam_segment(params):
    """
    SAM 图像分割
    参数: image_path (str), points (可选 [(x,y), ...]), labels (可选 [1/-1, ...])
    返回: 分割 mask 的 base64 编码
    """
    image_path = params.get("image_path")
    if not image_path:
        return _error("INVALID_PARAMS", "image_path is required")

    try:
        import cv2
        import base64

        image = cv2.imread(image_path)
        if image is None:
            return _error("IMAGE_ERROR", f"Cannot read image: {image_path}")

        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        predictor = _get_sam_predictor()
        predictor.set_image(image)

        # 如果有用户提供的点，使用点提示；否则全图分割
        points = params.get("points")
        if points:
            import numpy as np
            input_points = np.array(points)
            input_labels = np.array(params.get("labels", [1] * len(points)))
            masks, scores, _ = predictor.predict(
                point_coords=input_points,
                point_labels=input_labels,
                multimask_output=False,
            )
        else:
            # 自动全图分割（简化版：取中心点做提示）
            h, w = image.shape[:2]
            predictor.point_coords = None
            masks, scores, _ = predictor.predict(
                box=None,
                multimask_output=True,
            )

        if masks is None or len(masks) == 0:
            return _error("SEGMENT_FAILED", "No masks generated")

        # 取最高置信度的 mask，编码为 PNG base64
        best_mask = masks[scores.argmax()] if len(scores) > 0 else masks[0]
        mask_image = (best_mask * 255).astype("uint8")
        _, buffer = cv2.imencode(".png", mask_image)
        mask_b64 = base64.b64encode(buffer).decode("utf-8")

        return {
            "masks": [mask_b64],
            "scores": scores.tolist() if len(scores) > 0 else [1.0],
        }
    except Exception as e:
        return _error("SAM_ERROR", str(e))


_midas_model = None
_midas_transform = None


def _get_midas():
    """懒加载 MiDaS 深度估计模型"""
    global _midas_model, _midas_transform
    if _midas_model is None:
        import torch

        try:
            # 优先使用 torch.hub 加载轻量 MiDaS small
            _midas_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
            _midas_transform = torch.hub.load("intel-isl/MiDaS", "transforms").small_transform
        except Exception:
            _check_module("timm", "timm")
            _midas_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
            _midas_transform = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True).small_transform

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _midas_model.to(device)
        _midas_model.eval()

    return _midas_model, _midas_transform


def handle_depth_estimate(params):
    """
    MiDaS 单图深度估计
    参数: image_path (str)
    返回: 深度灰度图的 base64 编码
    """
    image_path = params.get("image_path")
    if not image_path:
        return _error("INVALID_PARAMS", "image_path is required")

    try:
        import cv2
        import torch
        import numpy as np
        import base64

        img = cv2.imread(image_path)
        if img is None:
            return _error("IMAGE_ERROR", f"Cannot read image: {image_path}")

        model, transform = _get_midas()
        device = next(model.parameters()).device

        input_batch = transform(img).to(device)

        with torch.no_grad():
            prediction = model(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=img.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()

        depth = prediction.cpu().numpy()

        # 归一化到 0-255
        depth_min = depth.min()
        depth_max = depth.max()
        if depth_max - depth_min > 0:
            depth_normalized = ((depth - depth_min) / (depth_max - depth_min)) * 255
        else:
            depth_normalized = np.zeros_like(depth)

        depth_uint8 = depth_normalized.astype("uint8")
        _, buffer = cv2.imencode(".png", depth_uint8)
        depth_b64 = base64.b64encode(buffer).decode("utf-8")

        return {
            "depth_image": depth_b64,
            "min_depth": float(depth_min),
            "max_depth": float(depth_max),
        }
    except Exception as e:
        return _error("DEPTH_ERROR", str(e))


def handle_extract_frames(params):
    """
    使用 ffmpeg 提取视频关键帧 (P1-3)
    参数: video_path (str), max_frames (int, 默认10), output_dir (str)
    返回: frames 文件路径列表
    """
    import subprocess
    import os
    import tempfile

    video_path = params.get("video_path")
    if not video_path or not os.path.isfile(video_path):
        return _error("INVALID_PARAMS", "video_path is required and must exist")

    max_frames = params.get("max_frames", 10)
    output_dir = params.get("output_dir") or tempfile.mkdtemp(prefix="video_frames_")
    os.makedirs(output_dir, exist_ok=True)

    output_pattern = os.path.join(output_dir, "frame-%04d.jpg")

    try:
        # 优先使用 scene 检测，失败则均匀间隔
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vf", "select='gt(scene,0.3)',scale=1024:-1",
            "-vsync", "vfr",
            "-frames:v", str(max_frames),
            output_pattern,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

        if result.returncode != 0:
            # 回退: 均匀间隔抽取
            fps_cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
                       "-show_format", video_path]
            probe = subprocess.run(fps_cmd, capture_output=True, text=True, timeout=10)
            duration = 60
            if probe.returncode == 0:
                import json as _json
                info = _json.loads(probe.stdout)
                duration = float(info.get("format", {}).get("duration", 60))

            interval = max(1, duration / max_frames)
            cmd2 = [
                "ffmpeg", "-y", "-i", video_path,
                "-vf", f"fps=1/{interval},scale=1024:-1",
                "-frames:v", str(max_frames),
                output_pattern,
            ]
            subprocess.run(cmd2, capture_output=True, text=True, timeout=180)

        # 收集输出帧
        frames = sorted([
            os.path.join(output_dir, f)
            for f in os.listdir(output_dir)
            if f.startswith("frame-") and f.endswith(".jpg")
        ])

        return {
            "frames": frames,
            "frame_count": len(frames),
            "output_dir": output_dir,
        }
    except FileNotFoundError:
        return _error("FFMPEG_NOT_FOUND", "ffmpeg 不可用，请安装 ffmpeg")
    except Exception as e:
        return _error("EXTRACT_ERROR", str(e))


# ---------------------------------------------------------------------------
#  消息分发
# ---------------------------------------------------------------------------

HANDLERS = {
    "analyze_colors": handle_analyze_colors,
    "analyze_metadata": handle_analyze_metadata,
    "ocr": handle_ocr,
    "object_detection": handle_object_detection,
    "image_similarity": handle_image_similarity,
    "health": handle_health,
    "sam_segment": handle_sam_segment,
    "depth_estimate": handle_depth_estimate,
    "extract_frames": handle_extract_frames,
}


def _rgb_dict(rgb_tuple):
    return {"r": rgb_tuple[0], "g": rgb_tuple[1], "b": rgb_tuple[2]}


def _error(code, message):
    return {"__error__": True, "code": code, "message": message}


def process_request(msg):
    """处理单个 JSON-RPC 请求，返回响应 dict"""
    req_id = msg.get("id", "unknown")
    method = msg.get("method", "")
    params = msg.get("params", {})

    if method not in HANDLERS:
        return {
            "id": req_id,
            "success": False,
            "error": {"code": "UNKNOWN_METHOD", "message": f"Unknown method: {method}"},
        }

    try:
        result = HANDLERS[method](params)
        if isinstance(result, dict) and result.get("__error__"):
            return {
                "id": req_id,
                "success": False,
                "error": {"code": result["code"], "message": result["message"]},
            }
        return {"id": req_id, "success": True, "result": result}
    except RuntimeError as e:
        return {
            "id": req_id,
            "success": False,
            "error": {"code": "MODEL_ERROR", "message": str(e)},
        }
    except Exception as e:
        return {
            "id": req_id,
            "success": False,
            "error": {"code": "INTERNAL_ERROR", "message": str(e)},
        }


# ---------------------------------------------------------------------------
#  主循环
# ---------------------------------------------------------------------------

def main():
    """StdIO JSON-RPC 主循环：读一行 → 处理 → 写一行 → 刷新"""
    # 启动信号
    startup_msg = json.dumps({
        "type": "startup",
        "pid": os.getpid(),
        "models": list(MODELS.keys()),
    })
    sys.stdout.write(startup_msg + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # 处理关闭信号
        if line == "__SHUTDOWN__":
            break

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            resp = json.dumps({
                "id": "unknown",
                "success": False,
                "error": {"code": "INVALID_JSON", "message": "Failed to parse JSON"},
            })
            sys.stdout.write(resp + "\n")
            sys.stdout.flush()
            continue

        response = process_request(msg)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
