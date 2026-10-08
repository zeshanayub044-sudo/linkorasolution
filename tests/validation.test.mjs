import assert from 'node:assert/strict';
import test from 'node:test';
import { secretRules, hasConflict } from '../scripts/validate.mjs';

test('secret guard permits public Auth keys and rejects service-role JWTs', () => {
  const jwt = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({role})).toString('base64url'), 'signature'].join('.');
  assert.deepEqual(secretRules(jwt('anon')), []);
  assert.deepEqual(secretRules(jwt('service_role')), ['service-role JWT']);
});
test('secret guard reports credential classes without returning values', () => {
  const key = 'gh' + 'p_' + 'a'.repeat(36);
  assert.deepEqual(secretRules(key), ['GitHub token']);
  assert.deepEqual(secretRules('postgres' + 'ql://user:real-password@host/db'), ['credential-bearing database URL']);
  assert.deepEqual(secretRules(['pass', 'word'].join('') + ' = ' + JSON.stringify('real-credential-value')), ['literal secret']);
  assert.deepEqual(secretRules(['pass', 'word'].join('') + ' = ' + JSON.stringify('your-password-here')), []);
});
test('conflict guard rejects unresolved blocks but permits prose and SQL separators', () => {
  for (const marker of ['<'.repeat(7) + ' HEAD', '='.repeat(7), '>'.repeat(7) + ' branch']) assert.equal(hasConflict(marker), true);
  assert.equal(hasConflict('Use conflict markers carefully.\n-- ====================\n'), false);
});
