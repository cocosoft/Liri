"""
vision_worker.py — Liri 视觉分析常驻进程
通过 StdIO (stdin/stdout) 接收 JSON-RPC 请求，每行一个 JSON 消息
协议：换行分隔，`write(json + '\\n')` 发送，`readline()` 读取

用法：python vision_worker.py

支持的模型（按需导入，首次使用时自动 pip install）：
  - colorthief: 主色调提取 (pip install colorthief)
  - Pillow: 图片元数据读取 (pip install Pillow)

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


def handle_health(_params):
    """健康检查"""
    return {"status": "ok", "python_version": sys.version, "models": list(MODELS.keys())}


# ---------------------------------------------------------------------------
#  消息分发
# ---------------------------------------------------------------------------

HANDLERS = {
    "analyze_colors": handle_analyze_colors,
    "analyze_metadata": handle_analyze_metadata,
    "health": handle_health,
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
    startup_msg = json.dumps({"type": "startup", "pid": os.getpid(), "models": list(MODELS.keys())})
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
            resp = json.dumps({"id": "unknown", "success": False, "error": {"code": "INVALID_JSON", "message": "Failed to parse JSON"}})
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
