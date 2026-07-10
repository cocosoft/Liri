"""
直接测试 SiliconFlow 视频 API
"""
import sqlite3, json, urllib.request, urllib.error, time

DB_PATH = r"e:\PY\CODES\PY_APP\app\data\pyapp\data\app.db"
db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# 获取 SiliconFlow API Key
silicon = db.execute(
    "SELECT api_key, base_url FROM ai_providers WHERE provider_type = 'siliconflow'"
).fetchone()
db.close()

if not silicon or not silicon['api_key']:
    print("❌ SiliconFlow API Key 未配置")
    exit(1)

api_key = silicon['api_key']
base_url = silicon['base_url'].rstrip('/')
print(f"Base URL: {base_url}")
print(f"API Key: {api_key[:10]}...")

# 测试候选模型列表
candidate_models = [
    ("Lightricks/LTX-Video", "T2V"),
    ("tencent/HunyuanVideo", "T2V"),
    ("genmo/mochi-1-preview", "T2V"),
    ("Wan-AI/Wan2.2-I2V-A14B", "I2V"),
    ("stabilityai/stable-video-diffusion-img2vid-xt", "I2V"),
    ("Wan-AI/Wan2.2-T2V-A14B", "T2V"),
    ("Lightricks/LTX-Video-0.9", "T2V"),
]

for model_id, model_type in candidate_models:
    print(f"\n--- 测试 {model_id} ({model_type}) ---")

    # 构建请求 body
    body = {
        "model": model_id,
        "prompt": "A cat walking on a sunny beach, cinematic quality",
    }
    if model_type == "I2V":
        body["image"] = "https://fal.media/files/elephant/Dh9k7ZQYgAE4KJN.jpg"

    try:
        req = urllib.request.Request(
            f"{base_url}/video/submit",
            data=json.dumps(body).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}',
            },
            method='POST'
        )
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read().decode('utf-8'))
        print(f"  ✅ 提交成功: {json.dumps(result, ensure_ascii=False)}")

        # 如果有 requestId，轮询状态
        request_id = result.get('requestId')
        if request_id:
            print(f"  requestId: {request_id}")
            # 轮询一次状态
            time.sleep(3)
            status_req = urllib.request.Request(
                f"{base_url}/video/status",
                data=json.dumps({"requestId": request_id}).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                },
                method='POST'
            )
            status_resp = urllib.request.urlopen(status_req, timeout=15)
            status_result = json.loads(status_resp.read().decode('utf-8'))
            print(f"  状态: {json.dumps(status_result, ensure_ascii=False)}")

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"  ❌ HTTP {e.code}: {error_body}")
    except Exception as e:
        print(f"  ❌ 异常: {e}")