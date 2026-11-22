"use strict";
const { adapt } = require("./_netlify-adapter.cjs");
const { handler } = require("../netlify/functions/sync.js");
module.exports = adapt(handler);
