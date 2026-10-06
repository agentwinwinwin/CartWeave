// Optional external runtime; ordinary contributors can install Playwright locally.
const path = require('node:path');
module.exports = require(process.env.CODEX_NODE_MODULES
  ? path.join(process.env.CODEX_NODE_MODULES, 'playwright')
  : 'playwright');
