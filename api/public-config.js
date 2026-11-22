"use strict";
const { adapt } = require("./_netlify-adapter.cjs");
const { handler } = require("../netlify/functions/public-config.js");
module.exports = adapt(handler);
