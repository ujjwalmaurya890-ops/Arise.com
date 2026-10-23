'use strict';

class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validConfiguredEmail(email) {
  if (email.length > 254 || email.endsWith('.invalid')) return false;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64) return false;
  // Conservative unquoted mailbox syntax supported by normal Google accounts.
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(parts[0])) return false;
  const labels = parts[1].split('.');
  return labels.length >= 2 && parts[1].length <= 253 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    (/^[a-z]{2,63}$/.test(labels.at(-1)) || /^xn--[a-z0-9-]{2,59}$/.test(labels.at(-1)));
}

// No Gmail dot/plus rewriting: only case and surrounding whitespace are normalized.
function validateAllowlist(config) {
  const emails = config && config.enabled === true && config.approvedEmails;
  if (!Array.isArray(emails) || emails.length !== 5) throw new ApiError(503, 'access-unavailable');
  const normalized = emails.map(normalizeEmail);
  if (normalized.some(email => !validConfiguredEmail(email)) || new Set(normalized).size !== 5) {
    throw new ApiError(503, 'access-unavailable');
  }
  return normalized;
}

function checkIdentity(decoded, config) {
  const approved = validateAllowlist(config);
  const email = normalizeEmail(decoded && decoded.email);
  if (!decoded || typeof decoded.uid !== 'string' || !decoded.uid || decoded.uid.length > 128 || decoded.uid.includes('/') ||
      decoded.email_verified !== true || decoded.firebase?.sign_in_provider !== 'google.com' || !email || !approved.includes(email)) {
    throw new ApiError(403, 'access-denied');
  }
  return { uid: decoded.uid, email, name: typeof decoded.name === 'string' ? decoded.name.slice(0, 160) : '',
    photoURL: typeof decoded.picture === 'string' && /^https:\/\//.test(decoded.picture) ? decoded.picture.slice(0, 2000) : null, emailVerified: true };
}

async function authorize(event, services) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw new ApiError(401, 'sign-in-required');
  let decoded;
  try { decoded = await services.auth.verifyIdToken(match[1], true); } // checkRevoked, issuer, audience, signature, expiry
  catch { throw new ApiError(401, 'session-expired'); }
  let config;
  try { config = (await services.db.doc('_config/access').get()).data(); }
  catch { throw new ApiError(503, 'access-unavailable'); }
  return { identity: checkIdentity(decoded, config), decoded };
}

module.exports = { ApiError, normalizeEmail, validateAllowlist, checkIdentity, authorize };
