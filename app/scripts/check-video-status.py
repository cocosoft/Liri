import sqlite3, json, os

# 项目实际 DB 路径
db_path = r"e:\PY\CODES\PY_APP\app\data\pyapp\data\app.db"
print(f"DB path: {db_path}")
print(f"Exists: {os.path.exists(db_path)}")

db = sqlite3.connect(db_path)
db.row_factory = sqlite3.Row

# 1. 列出所有表
print("\n=== 所有表 ===")
tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
for t in tables:
    c = db.execute(f"SELECT COUNT(*) as cnt FROM [{t['name']}]").fetchone()
    print(f"  {t['name']} ({c['cnt']} rows)")

# 2. 视频模型
print("\n=== 视频模型 (capabilities 含 video_generation) ===")
try:
    rows = db.execute(
        "SELECT id, model_id, display_name, capabilities, enabled, provider_id "
        "FROM model_registry WHERE capabilities LIKE '%video_generation%'"
    ).fetchall()
    for r in rows:
        print(f"  id={r['id'][:8]}..., model_id={r['model_id']}, "
              f"display_name={r['display_name']}, enabled={r['enabled']}, "
              f"provider_id={r['provider_id'][:8]}...")
except Exception as e:
    print(f"  Error: {e}")

# 3. SiliconFlow 供应商
print("\n=== SiliconFlow 供应商 ===")
try:
    rows = db.execute(
        "SELECT id, name, base_url, provider_type, api_key "
        "FROM ai_providers WHERE provider_type = 'siliconflow'"
    ).fetchall()
    for r in rows:
        key = r['api_key'] or ''
        key_preview = (key[:10] + '...') if len(key) > 8 else '(empty)'
        print(f"  id={r['id']}, name={r['name']}, base_url={r['base_url']}, "
              f"api_key={key_preview}")
except Exception as e:
    print(f"  Error: {e}")

# 4. 所有已启用的模型
print("\n=== 所有已启用的模型 (enabled=1) ===")
try:
    rows = db.execute(
        "SELECT model_id, display_name, capabilities, provider_id "
        "FROM model_registry WHERE enabled = 1"
    ).fetchall()
    for r in rows:
        caps = json.loads(r['capabilities'] or '[]')
        print(f"  {r['model_id']} ({r['display_name']}) -> {caps}")
except Exception as e:
    print(f"  Error: {e}")

db.close()