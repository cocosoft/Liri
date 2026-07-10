/**
 * 直接测试 SiliconFlow 视频 API
 */
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

const db = new Database(join(homedir(), '.pyapp', 'data', 'app.db'), { readonly: true });
const silicon = db.query("SELECT api_key FROM ai_providers WHERE provider_type = 'siliconflow' AND is_active = 1").get() as any;
db.close();

// API Key 可能在 DB 中加密存储，但 OpenAIProvider.setApiKey 会直接使用
// 这里的 key 可能就是解密后的（取决于存储方式）
const apiKey = silicon?.api_key || '';
console.log('API Key 长度:', apiKey.length, '前缀:', apiKey.slice(0, 10) + '...');

const models = ['Lightricks/LTX-Video', 'tencent/HunyuanVideo', 'genmo/mochi-1-preview', 'Wan-AI/Wan2.2-I2V-A14B'];

for (const model of models) {
  try {
    const resp = await fetch('https://api.siliconflow.cn/v1/video/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({ model, prompt: 'test' }),
    });
    const data = await resp.text();
    console.log(`${model}: ${resp.status} - ${data.slice(0, 200)}`);
  } catch (e) {
    console.log(`${model}: ERROR - ${(e as Error).message}`);
  }
}