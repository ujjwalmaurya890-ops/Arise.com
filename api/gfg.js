"use strict";
const { adapt } = require("./_netlify-adapter.cjs");
const { handler } = require("../netlify/functions/gfg.js");
module.exports = adapt(handler);
