"use strict";
const { adapt } = require("./_netlify-adapter.cjs");
const { handler } = require("../netlify/functions/leetcode.js");
module.exports = adapt(handler);
