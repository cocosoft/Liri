import pathlib

fpath = pathlib.Path('e:/PY/CODES/PY_APP/app/src/commands/manager/CommandManager.ts')
raw = fpath.read_bytes()
lines = raw.split(b'\n')

# Find all lines with // comment that might have collapse (including } { etc)
for i, line_bytes in enumerate(lines):
    if b'//' not in line_bytes:
        continue
    
    decoded = line_bytes.decode('latin-1')
    comment_idx = line_bytes.find(b'//')
    after_comment = decoded[comment_idx + 2:]  # text after //
    
    if '?' not in after_comment:
        continue
    
    # Check what's after the LAST ?
    last_q = after_comment.rfind('?')
    after_q = after_comment[last_q + 1:]
    trimmed = after_q.strip()
    
    if trimmed:
        print(f'L{i+1}: -> [{trimmed[:60]}]')
        print(f'  Full: {decoded.strip()[:120]}')
        print()
