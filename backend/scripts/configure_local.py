"""Generate private development configuration, never print credentials."""
import json
import os
import secrets
from pathlib import Path
from cryptography.fernet import Fernet

directory = Path(__file__).resolve().parents[1] / '.local'
directory.mkdir(mode=0o700, exist_ok=True)
target = directory / 'config.json'
if not target.exists():
    with target.open('x') as file:
        os.chmod(target, 0o600)
        json.dump({'secret_key': secrets.token_urlsafe(64), 'credential_key': Fernet.generate_key().decode()}, file)
print('Local secrets ready in backend/.local/config.json (not displayed).')
