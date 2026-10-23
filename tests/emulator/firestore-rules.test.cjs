'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const host = process.env.FIRESTORE_EMULATOR_HOST;

test('real Firestore rules and trusted API transactions (emulator required)', { skip: !host && 'No running Firestore emulator. This is NOT a passed authorization test.' }, async t => {
  assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'Use only a local emulator, never a production database.');
  const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
  const { doc, setDoc, getDoc, deleteDoc, getDocs, collection } = require('firebase/firestore');
  const projectId = 'demo-arise-security';
  const [hostname, port] = host.split(':');
  const environment = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8') } });
  const emails = [1, 2, 3, 4, 5].map(i => 'approved' + i + '@example.test');
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), '_config/access'), { enabled: true, approvedEmails: emails });
      await setDoc(doc(context.firestore(), 'users/uid-1/records/seed'), { key: 'private-seed', value: 'private' });
    });
    await t.test('unauthenticated, five approved and sixth identities all fail direct read/write/delete/config access', async () => {
      const contexts = [environment.unauthenticatedContext(), ...[1, 2, 3, 4, 5, 6].map(i => environment.authenticatedContext('uid-' + i, {
        email: i === 6 ? 'sixth@example.test' : emails[i - 1], email_verified: true, firebase: { sign_in_provider: 'google.com' }
      }))];
      for (const context of contexts) {
        const db = context.firestore();
        for (const location of ['users/uid-1/records/seed', 'users/uid-2/records/private', '_config/access']) {
          await assertFails(getDoc(doc(db, location)));
          await assertFails(setDoc(doc(db, location), { approvedEmails: ['attacker@example.test'], value: 'overwrite' }));
          await assertFails(deleteDoc(doc(db, location)));
        }
        await assertFails(getDocs(collection(db, 'users/uid-1/records')));
        await assertFails(setDoc(doc(db, 'users/uid-1/activity/invented'), { sequence: 0 }));
      }
    });
    await t.test('Admin API has real atomic CAS, own-UID isolation, verified Google policy and revocation checks', async () => {
      const { initializeApp, deleteApp } = require('firebase-admin/app');
      const { getFirestore, FieldValue } = require('firebase-admin/firestore');
      const { createHandler } = require('../../server/cloud.cjs');
      const app = initializeApp({ projectId }, 'arise-emulator-' + Date.now()), db = getFirestore(app);
      try {
        const handler = createHandler(() => ({ db, timestamp: () => FieldValue.serverTimestamp(), auth: { verifyIdToken: async (token, checkRevoked) => {
          assert.equal(checkRevoked, true);
          const index = Number(token.replace('token-', ''));
          if (!Number.isInteger(index) || index < 1 || index > 6) throw new Error('Rejected test identity');
          return { uid: 'uid-' + index, email: index === 6 ? 'sixth@example.test' : emails[index - 1], email_verified: true, firebase: { sign_in_provider: 'google.com' } };
        } } }));
        const call = (token, body, query = {}) => handler({ httpMethod: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : '', queryStringParameters: query });
        const body = value => ({ action: 'commit', key: 'tasks', value, baseVersion: 0, opId: crypto.randomUUID().replace(/-/g, '') });
        const attempts = await Promise.all([call('token-1', body('["A"]')), call('token-1', body('["B"]'))]);
        assert.deepEqual(attempts.map(result => result.statusCode).sort(), [200, 409]);
        assert.equal((await call('token-2', undefined, { action: 'read', key: 'tasks' })).statusCode, 404);
        assert.equal((await call('token-6')).statusCode, 403);
        await db.doc('_config/access').delete(); assert.equal((await call('token-1')).statusCode, 503);
      } finally { await db.terminate(); await deleteApp(app); }
    });
  } finally { await environment.cleanup(); }
});
