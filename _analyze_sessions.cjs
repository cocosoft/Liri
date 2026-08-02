const fs = require('fs');
const path = require('path');
const base = 'E:\\PY\\Documents\\CODES\\PY_APP\\app\\data\\pyapp\\data\\sessions\\default';
const dirs = fs.readdirSync(base).filter((d) => {
  try { return fs.statSync(path.join(base, d)).isDirectory(); } catch { return false; }
});
let ok = 0, bad = 0, noMsg = 0, withMsg = 0, crash = 0;
const rows = [];
for (const d of dirs) {
  const sj = path.join(base, d, 'session.json');
  try {
    const s = JSON.parse(fs.readFileSync(sj, 'utf8'));
    const mf = path.join(base, d, 'messages.jsonl');
    const ms = fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
    const isCrash = !!(s.metadata && s.metadata.crashRecovery);
    if (isCrash) crash++;
    if (ms > 0) withMsg++; else noMsg++;
    rows.push({
      id: s.id,
      created: new Date(s.createdAt).toISOString().slice(0, 10),
      updated: new Date(s.updatedAt).toISOString().slice(0, 10),
      msgs: ms,
      status: s.status,
      crash: isCrash,
      title: (s.title || '').slice(0, 20),
    });
  } catch (e) { bad++; }
}
console.log('total dirs:', dirs.length, 'parsed:', rows.length, 'bad:', bad, 'withMsg:', withMsg, 'noMsg:', noMsg, 'crash:', crash);
console.log('--- by created date (count, withMsg, noMsg) ---');
const byDate = {};
for (const r of rows) {
  byDate[r.created] = byDate[r.created] || { total: 0, withMsg: 0, noMsg: 0 };
  byDate[r.created].total++;
  if (r.msgs > 0) byDate[r.created].withMsg++; else byDate[r.created].noMsg++;
}
console.log(JSON.stringify(byDate, null, 1));
console.log('--- sessions with 0 messages ---');
for (const r of rows.filter((r) => r.msgs === 0)) {
  console.log(r.created, r.id, r.status, 'crash=' + r.crash, r.title);
}
console.log('--- sessions with messages (top by created desc) ---');
for (const r of rows.filter((r) => r.msgs > 0).sort((a, b) => b.created.localeCompare(a.created)).slice(0, 30)) {
  console.log(r.created, r.updated, 'msgs=' + r.msgs, r.status, 'crash=' + r.crash, r.title);
}
