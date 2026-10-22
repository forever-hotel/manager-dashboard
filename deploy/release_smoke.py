"""Run existing HTTPS login smoke in a deadline-bounded child process."""
import json
from pathlib import Path
import sys
from staging_smoke import smoke

if __name__ == '__main__':
    try:
        config = Path(sys.argv[1])
        runtime = json.loads((config / 'runtime.json').read_text())
        smoke(runtime['origin'], runtime['apiOrigin'],
              json.loads((config / 'smoke.json').read_text()))
    except Exception:
        print('Release smoke failed; restricted operator diagnosis required.')
        raise SystemExit(1)
