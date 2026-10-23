'use strict';
const { ApiError } = require('./access.cjs');
let services;

function getServices() {
  if (services) return services;
  // No emulator/unsigned-token escape hatch is permitted in the deployed functions.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    throw new ApiError(503, 'configuration-unavailable');
  }
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  let account;
  try {
    account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    if (!account.project_id || !account.client_email || !account.private_key || account.project_id !== process.env.FIREBASE_PROJECT_ID) throw new Error();
  } catch { throw new ApiError(503, 'configuration-unavailable'); }
  try {
    const app = getApps().find(app => app.name === 'arise-server') || initializeApp({ credential: cert(account), projectId: account.project_id }, 'arise-server');
    services = { auth: getAuth(app), db: getFirestore(app), timestamp: () => FieldValue.serverTimestamp() };
    return services;
  } catch { throw new ApiError(503, 'configuration-unavailable'); }
}

function publicConfig() {
  const config = {
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: process.env.FIREBASE_WEB_APP_ID
  };
  if (Object.values(config).some(value => typeof value !== 'string' || !value || /PLACEHOLDER|your-|replace-/i.test(value)) ||
      !/^AIza[\w-]{20,}$/.test(config.apiKey) || !/^[a-z0-9.-]+$/.test(config.authDomain) || !/^[a-z][a-z0-9-]{4,60}$/.test(config.projectId)) {
    throw new ApiError(503, 'configuration-unavailable');
  }
  return config;
}
module.exports = { getServices, publicConfig };
