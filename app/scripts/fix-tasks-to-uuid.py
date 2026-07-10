"""查询所有模型 UUID 映射，修复两个 config.json 中的任务分工"""
import sqlite3, json, os

DB_PATH = r"e:\PY\CODES\PY_APP\app\data\pyapp\data\app.db"
CONFIG_PATHS = [
    r"e:\PY\CODES\PY_APP\app\data\pyapp\config.json",
    os.path.expanduser(r"~\.pyapp\config.json"),
]

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

# 1. 获取所有模型的 UUID 映射
print("=== 模型 UUID 映射 ===")
models = db.execute(
    "SELECT id, model_id, display_name, capabilities FROM model_registry WHERE enabled = 1"
).fetchall()

model_name_to_uuid = {}
model_uuid_to_name = {}
for m in models:
    model_name_to_uuid[m['model_id']] = m['id']
    model_uuid_to_name[m['id']] = m['model_id']
    caps = json.loads(m['capabilities'] or '[]')
    print(f"  {m['model_id']} → {m['id']}  caps={caps}")

db.close()

# 2. 修复每个 config 文件
for config_path in CONFIG_PATHS:
    if not os.path.exists(config_path):
        print(f"\n⚠️ 配置文件不存在: {config_path}")
        continue

    print(f"\n=== 修复: {config_path} ===")
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    tasks = config.get('models', {}).get('tasks', {})
    if not tasks:
        print("  无 tasks 配置，跳过")
        continue

    changes = []
    for task_key, task_value in list(tasks.items()):
        if not task_value:
            continue

        # 已经是 UUID 格式（36位 hex）
        is_uuid = len(task_value) == 36 and task_value.count('-') == 4
        if is_uuid:
            # 验证 UUID 是否在 DB 中存在
            if task_value in model_uuid_to_name:
                print(f"  {task_key}: {task_value[:8]}... → {model_uuid_to_name[task_value]} ✅ (已是 UUID)")
            else:
                print(f"  {task_key}: {task_value[:8]}... ⚠️ UUID 在 DB 中未找到!")
            continue

        # 模型名 → UUID
        if task_value in model_name_to_uuid:
            uuid_val = model_name_to_uuid[task_value]
            tasks[task_key] = uuid_val
            changes.append((task_key, task_value, uuid_val))
            print(f"  {task_key}: \"{task_value}\" → {uuid_val[:8]}... ✅")
        else:
            print(f"  {task_key}: \"{task_value}\" ⚠️ 模型名在 DB 中未找到!")

    if changes:
        config['models']['tasks'] = tasks
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        print(f"  已保存 {len(changes)} 处修改")
    else:
        print("  无需修改")

print("\n✅ 完成")