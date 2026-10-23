'use strict';
const { createHandler } = require('../../server/cloud.cjs');
const { getServices } = require('../../server/firebase.cjs');
exports.handler = createHandler(getServices);
