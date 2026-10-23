'use strict';
const { publicConfig } = require('../../server/firebase.cjs');
const { respond, fail } = require('../../server/http.cjs');
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return respond(405, { error: 'method-not-allowed' });
  try { return respond(200, { firebase: publicConfig(), schemaVersion: 1 }); }
  catch (error) { return fail(error); }
};
