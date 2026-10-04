const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (typeof password !== 'string' || typeof storedPassword !== 'string') return false;

  const [algorithm, salt, storedHash] = storedPassword.split('$');
  if (algorithm === 'scrypt' && salt && storedHash) {
    const actualHash = crypto.scryptSync(password, salt, 64);
    const expectedHash = Buffer.from(storedHash, 'hex');
    return expectedHash.length === actualHash.length &&
      crypto.timingSafeEqual(actualHash, expectedHash);
  }

  const actual = Buffer.from(password);
  const expected = Buffer.from(storedPassword);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
