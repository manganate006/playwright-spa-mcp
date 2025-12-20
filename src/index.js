#!/usr/bin/env node
/**
 * Playwright SPA MCP Server
 * Entry point for the MCP server
 */

const { runServer } = require('./server');

runServer().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
