import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../../portal-config.js', import.meta.url), 'utf8');
const url = config.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const anonKey = config.match(/supabaseAnonKey:\s*'([^']+)'/)?.[1];
assert.ok(url && anonKey, 'Portal configuration is missing');

for (const authorization of [undefined, `Bearer ${anonKey}`]) {
  const response = await fetch(`${url}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ action: 'list' }),
  });
  assert.ok(response.status === 401 || response.status === 403,
    `Unprivileged request unexpectedly returned ${response.status}`);
  console.log(`Unprivileged admin request rejected (${response.status})`);
}
