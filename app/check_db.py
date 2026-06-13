import sqlite3
d = sqlite3.connect('C:/Users/Administrator/.pyapp/data/app.db')
print('=== DB CHECK ===')
print('model_usage_logs:', d.execute('SELECT COUNT(*) FROM model_usage_logs').fetchone()[0])
('cost_records:', d.execute('SELECT COUNT(*) FROM cost_records').fetchone()[0])
rows = d.execute('SELECT model, COUNT(*), SUM(input_tokens), SUM(output_tokens) FROM model__logs GROUP BY model').fetchall()
for r in rows:
    print(' ' + r[0] + ' + str(r[]) + ' calls, in=' + str(r[2]) + ' out=' + str[3]))
tables = d.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('ALL TABLES:')
for t in tables:
    cnt = d.execute('SELECT COUNT(*) FROM "' + t[0] + '"').fetchone()[0]
   ('  ' + t[0] + ': ' + str(cnt))
d.close()
