"""
注册正确可用的 T2V 模型 Wan-AI/Wan2.2-T2V-A14B 并更新任务分工
"""
import sqlite3, json, uuid, os, time

DB_PATH = r"e:\PY\CODES\PY_APP\app\data\pyapp\data\app.db"
CONFIG_PATH = r"e:\PY\CODES\PY_APP\app\data\pyapp\config.json"

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row
now = int(time.time())

# 获取 SiliconFlow 供应商
silicon = db.execute(
    "SELECT id FROM ai_providers WHERE provider_type = 'siliconflow'"
).fetchone()

# 注册 T2V 模型 Wan-AI/Wan2.2-T2V-A14B
t2v_model_id = "Wan-AI/Wan2.2-T2V-A14B"
existing = db.execute(
    "SELECT id FROM model_registry WHERE model_id = ?", (t2v_model_id,)
).fetchone()

if existing:
    print(f"⏭️ 已存在: {t2v_model_id} ({existing['id'][:8]}...)")
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
        new_id, t2v_model_id, "Wan2.2-T2V (SiliconFlow)",
        200000, 4096,
        json.dumps(["video_generation"]), "{}",
        0.5, 0, 0, 0,
        silicon['id'], 1, 1, now, now
    ))
    print(f"✅ 已注册: {t2v_model_id} ({new_id[:8]}...)")

db.commit()

# 更新任务分工
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

old_video = config['models']['tasks'].get('video', '(none)')
config['models']['tasks']['video'] = t2v_model_id

with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print(f"✅ 任务分工 video: \"{old_video}\" → \"{t2v_model_id}\"")

# 验证
print("\n=== 当前视频模型 ===")
rows = db.execute(
    "SELECT model_id, display_name, capabilities, enabled FROM model_registry "
    "WHERE capabilities LIKE '%video_generation%'"
).fetchall()
for r in rows:
    caps = json.loads(r['capabilities'] or '[]')
    print(f"  {r['model_id']} ({r['display_name']}) -> {caps} enabled={r['enabled']}")

print(f"\n=== 任务分工 ===")
print(json.dumps(config['models']['tasks'], indent=2, ensure_ascii=False))

db.close()
print("\n✅ 完成")