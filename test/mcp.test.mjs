import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const server = fileURLToPath(new URL('../src/mcp.mjs', import.meta.url));

test('stdio でつながり、ツールを呼べる（Chrome は起動しない）', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airregi-mcp-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, AIRREGI_APP_DATA: dataDir }, stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['cancel_download', 'get_download', 'list_reports', 'list_stores', 'open_login', 'start_download', 'status']);
    const start = tools.find(t => t.name === 'start_download');
    assert.deepEqual(start.inputSchema.required.sort(), ['from', 'report', 'stores', 'to']);

    const reports = JSON.parse((await client.callTool({ name: 'list_reports', arguments: {} })).content[0].text);
    assert.ok(reports.reports.length >= 4);

    const status = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text);
    assert.equal(status.dataDirectory, dataDir);
    assert.equal(status.browserOpen, false);

    const bad = await client.callTool({ name: 'start_download', arguments: { report: 'daily_sales', stores: ['A'], from: '2025-02-01', to: '2025-01-01' } });
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse(bad.content[0].text).error.code, 'INVALID_RANGE');
  } finally {
    await client.close();
  }
});
