#!/usr/bin/env node
'use strict';
// Owner-only tool. Credentials come from the local environment, never the browser.
const fs = require('node:fs');
const { validateAllowlist } = require('../server/access.cjs');
const { getServices } = require('../server/firebase.cjs');
(async () => {
  const args = process.argv.slice(2), filename = args[0], index = args.indexOf('--project');
  if (!filename || index < 0 || !args[index + 1]) throw new Error('Usage: node --env-file-if-exists=.env scripts/configure-access.cjs config/approved-users.json --project YOUR_PROJECT_ID [--apply]');
  if (args[index + 1] !== process.env.FIREBASE_PROJECT_ID) throw new Error('Project confirmation must exactly match FIREBASE_PROJECT_ID. No changes made.');
  const source = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const approvedEmails = validateAllowlist(source);
  if (!args.includes('--apply')) { console.log('Valid, normalized five-account configuration. Dry run only; add --apply to update the confirmed project.'); return; }
  const services = getServices();
  await services.db.doc('_config/access').set({ enabled: true, approvedEmails, schemaVersion: 1, updatedAt: services.timestamp() });
  console.log('Five-account policy updated in the confirmed project. It is rechecked on every protected request; no frontend rebuild is needed.');
})().catch(() => { console.error('Access configuration was not applied. Check the five distinct real emails, project confirmation, JSON file and server credentials.'); process.exitCode = 1; });
