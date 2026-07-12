/**
 * 修复 ai_app_model_configs 缺失视频任务配置
 *
 * 问题：DB 表 ai_app_model_configs 仅有 default: deepseek-chat，
 * 缺少 image_to_video / text_to_video / video 任务配置，
 * 导致 ModelRouter.resolve() 能力路由无法找到视频模型。
 *
 * 修复：根据 model_registry 中已有的视频模型，填充任务分工配置。
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";

const DB_PATH = join(homedir(), ".pyapp", "data", "app.db");
const now = Math.floor(Date.now() / 1000);

console.log(`DB 路径: ${DB_PATH}`);
const db = new Database(DB_PATH);

// 1. 查询已注册的视频模型
interface ModelRow {
  id: string;
  model_id: string;
  capabilities: string;
  enabled: number;
}

const models = db
  .query(
    `SELECT id, model_id, capabilities, enabled
     FROM model_registry
     WHERE capabilities LIKE '%video%'
     ORDER BY model_id`
  )
  .all() as ModelRow[];

console.log(`\n找到 ${models.length} 个视频模型:`);
models.forEach((m) => {
  const caps = JSON.parse(m.capabilities || "[]");
  console.log(
    `  ${m.model_id} (${m.id.slice(0, 8)}...) caps: ${JSON.stringify(caps)} enabled: ${!!m.enabled}`
  );
});

// 2. 找到最适合的模型分配

// image_to_video: I2V 模型（带 image_to_video 能力）
const i2vModel = models.find(
  (m) =>
    m.enabled &&
    JSON.parse(m.capabilities || "[]").includes("image_to_video")
);

// text_to_video: T2V 模型（带 text_to_video 能力）
const t2vModel = models.find(
  (m) =>
    m.enabled &&
    JSON.parse(m.capabilities || "[]").includes("text_to_video")
);

// video: 优先 I2V，其次第一个启用的 video_generation 模型
const videoModel =
  i2vModel ||
  models.find(
    (m) =>
      m.enabled &&
      JSON.parse(m.capabilities || "[]").includes("video_generation")
  );

console.log("\n任务分工分配:");
console.log(`  image_to_video → ${i2vModel?.model_id || "(未找到)"}`);
console.log(`  text_to_video  → ${t2vModel?.model_id || "(未找到)"}`);
console.log(`  video          → ${videoModel?.model_id || "(未找到)"}`);

// 3. 写入 ai_app_model_configs 表
const upsertStmt = db.prepare(
  `INSERT INTO ai_app_model_configs (app_type, model, updated_at)
   VALUES (?, ?, ?)
   ON CONFLICT(app_type) DO UPDATE SET
     model = excluded.model,
     updated_at = excluded.updated_at`
);

const upsert = (appType: string, modelId: string) => {
  upsertStmt.run(appType, modelId, now);
  console.log(`  ✅ ${appType} → ${modelId}`);
};

console.log("\n写入 ai_app_model_configs:");
if (i2vModel) upsert("image_to_video", i2vModel.id);
if (t2vModel) upsert("text_to_video", t2vModel.id);
if (videoModel) upsert("video", videoModel.id);

// 4. 验证
console.log("\n=== 写入后验证 ===");
const configs = db
  .query(
    `SELECT app_type, model, updated_at
     FROM ai_app_model_configs
     WHERE app_type IN ('default', 'video', 'image_to_video', 'text_to_video')
     ORDER BY app_type`
  )
  .all() as { app_type: string; model: string }[];

configs.forEach((c) => {
  const modelRecord = models.find((m) => m.id === c.model);
  const modelName = modelRecord ? modelRecord.model_id : "未知";
  console.log(`  ${c.app_type}: ${modelName} (${c.model.slice(0, 16)}...)`);
});

db.close();
console.log("\n✅ 修复完成。重启应用后生效。");
