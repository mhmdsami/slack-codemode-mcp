#!/usr/bin/env node
import { VERSION } from '../src/config.mjs';

if (process.argv.includes('--version')) {
  console.log(VERSION);
  process.exit(0);
}

const { main } = await import('../src/server.mjs');
await main();
