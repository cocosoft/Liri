const http = require('http');
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 18990, path, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}
(async () => {
  try {
    const r = await get('/v1/sessions');
    const sessions = JSON.parse(r.data);
    console.log('HTTP', r.status, 'total sessions:', sessions.length);
    const byDate = {};
    for (const s of sessions) {
      const d = new Date(s.updatedAt).toISOString().slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    }
    console.log('by updatedAt date:');
    for (const [d, n] of Object.entries(byDate).sort()) console.log(' ', d, n);
    console.log('sessions with workspaceId:');
    for (const s of sessions) {
      const ws = s.metadata && s.metadata.workspaceId;
      if (ws) console.log(' ', s.id, s.title, ws);
    }
  } catch (e) {
    console.error('ERR', e.message);
  }
})();
