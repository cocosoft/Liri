"""
注册 T2V 视频模型并更新任务分工
DB 路径: app/data/pyapp/data/app.db
"""
import sqlite3, json, uuid, os, time

DB_PATH = r"e:\PY\CODES\PY_APP\app\data\pyapp\data\app.db"
CONFIG_PATH = os.path.expanduser(r"~\.pyapp\config.json")

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row
now = int(time.time())

# 1. 获取 SiliconFlow 供应商
silicon = db.execute(
    "SELECT id, name, base_url FROM ai_providers WHERE provider_type = 'siliconflow'"
).fetchone()

if not silicon:
    print("❌ 未找到 SiliconFlow 供应商")
    db.close()
    exit(1)

print(f"SiliconFlow: id={silicon['id']}, base_url={silicon['base_url']}")

# 2. 注册 T2V 模型
t2v_models = [
    ("Lightricks/LTX-Video", "LTX-Video (SiliconFlow)"),
    ("tencent/HunyuanVideo", "HunyuanVideo (SiliconFlow)"),
    ("genmo/mochi-1-preview", "Mochi-1 (SiliconFlow)"),
]

for model_id, display_name in t2v_models:
    existing = db.execute(
        "SELECT id FROM model_registry WHERE model_id = ?", (model_id,)
    ).fetchone()
    if existing:
        print(f"⏭️ 已存在: {model_id} ({existing['id'][:8]}...)")
    else:
        new_id = str(uuid.uuid4())
        db.execute("""
            INSERT INTO model_registry 
            (id, model_id, display_name, context_window, max_output_tokens,
             capabilities, provider_mappings, input_price, output_price, 
             cache_read_price, cache_write_price, provider_id, enabled, 
             is_custom, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_id, model_id, display_name,
            200000, 4096,
            json.dumps(["video_generation"]), "{}",
            0.5, 0, 0, 0,
            silicon['id'], 1, 1, now, now
        ))
        print(f"✅ 已注册: {model_id} ({new_id[:8]}...)")

db.commit()

# 3. 更新任务分工 → Lightricks/LTX-Video (T2V)
config = {}
if os.path.exists(CONFIG_PATH):
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)

if 'models' not in config:
    config['models'] = {}
if 'tasks' not in config['models']:
    config['models']['tasks'] = {}

old_video = config['models']['tasks'].get('video', '(none)')
config['models']['tasks']['video'] = 'Lightricks/LTX-Video'

with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print(f"✅ 任务分工 video: \"{old_video}\" → \"Lightricks/LTX-Video\"")

# 4. 验证
print("\n=== 当前视频模型 ===")
rows = db.execute(
    "SELECT model_id, display_name, capabilities, enabled, provider_id "
    "FROM model_registry WHERE capabilities LIKE '%video_generation%'"
).fetchall()
for r in rows:
    caps = json.loads(r['capabilities'] or '[]')
    prov = db.execute(
        "SELECT name, provider_type FROM ai_providers WHERE id = ?", 
        (r['provider_id'],)
    ).fetchone()
    prov_name = prov['name'] if prov else 'unknown'
    print(f"  {r['model_id']} ({r['display_name']}) -> {caps} [{prov_name}] enabled={r['enabled']}")

print(f"\n=== 任务分工 ===")
print(json.dumps(config['models']['tasks'], indent=2, ensure_ascii=False))

db.close()
print("\n✅ 完成")