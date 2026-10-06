"""Explicit local E2E: queue with worker stopped, then resume after API/worker restart."""
import json
import sys
import time
from pathlib import Path
import httpx

directory = Path(__file__).resolve().parents[1] / '.local'
access = json.loads((directory / 'development-access.json').read_text())
client = httpx.Client(base_url='http://127.0.0.1:8010/api/v1', timeout=15, trust_env=False)
session = client.get('/auth/session').json()
client.headers['X-CSRFToken'] = session['csrf_token']
response = client.post('/auth/login', json={'username': access['username'], 'password': access['password']})
response.raise_for_status()
client.headers['X-CSRFToken'] = response.json()['csrf_token']

def post(path, data):
    response = client.post(path, json=data)
    response.raise_for_status()
    return response.json()

state_file = directory / 'recovery-test.json'
if sys.argv[1] == '--prepare':
    sample = client.get('/templates').json()
    stores = client.get('/stores').json()
    store = next(s for s in stores if s['verified'])
    draft = post('/workflows', {'document': sample['document'], 'skill_id': sample['skill_id']})
    version = post(f'/workflows/{draft["id"]}/versions', {'expected_revision': draft['revision']})
    run = post('/runs', {'version_id': version['id'], 'store_id': store['id'], 'brief': sample['brief'], 'idempotency_key': 'recovery-' + sample['brief']['product_id']})
    time.sleep(2)
    assert client.get('/runs/' + run['id']).json()['status'] == 'queued', 'Stop the local worker before this preparation.'
    state_file.write_text(json.dumps({'run_id': run['id']}))
    print('Persisted task remains queued while the worker is stopped.')
else:
    run_id = json.loads(state_file.read_text())['run_id']
    approvals = set()
    for _ in range(60):
        run = client.get('/runs/' + run_id).json()
        if run['status'] == 'waiting_approval':
            approval = next(a for a in run['approvals'] if a['status'] == 'pending')
            if approval['id'] not in approvals:
                post(f'/approvals/{approval["id"]}/decisions', {'decision': 'approve', 'reason': 'Local recovery E2E approval, test publication only.', 'expected_revision': run['revision']})
                approvals.add(approval['id'])
        elif run['status'] == 'succeeded':
            assert len(approvals) == 2
            assert run['context']['published']['listing'] == run['context']['listing']
            print('API and worker restart recovered the persisted task; both approvals and actual publication verified.')
            break
        elif run['status'] == 'needs_attention':
            raise AssertionError(run['error'])
        time.sleep(1)
    else:
        raise AssertionError('Recovery timeout')
