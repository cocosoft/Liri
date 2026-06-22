import pathlib

fpath = pathlib.Path('e:/PY/CODES/PY_APP/app/src/commands/builtin/memory/Memory.ts')
raw = fpath.read_bytes()
lines = raw.split(b'\n')

for ln in [106, 108, 110, 111, 114, 115, 120, 122, 143, 144, 232, 233, 284, 346, 380]:
    idx = ln - 1
    if idx < len(lines):
        b = lines[idx]
        s = b.decode('latin-1')
        print('L{} ({} bytes): {}'.format(ln, len(b), s[:120]))
        if b'?' in b:
            q_pos = s.find('?')
            print('  ? at byte pos ' + str(q_pos) + ' (char ' + str(q_pos) + ')')
            # Show surrounding bytes
            start = max(0, q_pos - 10)
            end = min(len(b), q_pos + 15)
            context_hex = ' '.join('{:02x}'.format(x) for x in b[start:end])
            print('  context bytes [' + str(start) + ':' + str(end) + ']: ' + context_hex)
