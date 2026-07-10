import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.pyapp', 'data', 'app.db'), { readonly: true });

console.log('=== Wan/video models in production DB ===');
const models = db.query(
  "SELECT model_id, id, capabilities, enabled, provider_id FROM model_registry WHERE model_id LIKE '%Wan%' OR model_id LIKE '%video%' OR capabilities LIKE '%video%'"
).all();
console.log(JSON.stringify(models, null, 2));

console.log('\n=== All models in production DB ===');
const allModels = db.query('SELECT model_id, id, capabilities, enabled, provider_id FROM model_registry').all();
console.log(JSON.stringify(allModels, null, 2));

db.close();