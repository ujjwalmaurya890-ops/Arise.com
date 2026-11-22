"use strict";
const { adapt } = require("./_netlify-adapter.cjs");
const { handler } = require("../netlify/functions/codechef.js");
module.exports = adapt(handler);
