import pathlib

fpath = pathlib.Path('e:/PY/CODES/PY_APP/app/src/commands/builtin/memory/Memory.ts')
raw = fpath.read_bytes()
lines = raw.split(b'\n')

print("=== Lines with ? followed by , or ] or ) (missing closing ') ===")
for i, line_bytes in enumerate(lines):
    decoded = line_bytes.decode('latin-1')
    # Check if line ends with ? and then a punctuation/comma
    stripped = decoded.strip()
    
    # Pattern: missing ' before the closing , or ]
    # Look for lines in string arrays
    if "?" in stripped and stripped.endswith(','):
        # Might be missing closing ' before ,
        print(f'L{i+1}: ...{stripped[-80:]}')
    elif "?" in stripped and stripped.endswith(']'):
        print(f'L{i+1}: ...{stripped[-80:]}')

print()
print("=== All lines with ? markers ===")
for i, line_bytes in enumerate(lines):
    decoded = line_bytes.decode('latin-1')
    if '?' in decoded:
        stripped = decoded.strip()
        print(f'L{i+1}: {stripped[:120]}')
