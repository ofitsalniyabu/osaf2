const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hashPassword, verifyPassword } = require('../auth');

test('password hashes verify without storing the original password', () => {
  const password = 'a-strong-test-password';
  const hash = hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('legacy plaintext passwords can be verified during migration', () => {
  assert.equal(verifyPassword('legacy-password', 'legacy-password'), true);
  assert.equal(verifyPassword('wrong-password', 'legacy-password'), false);
});
