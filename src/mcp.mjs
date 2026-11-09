#!/usr/bin/env node
// エアレジのCSVを取得するMCPサーバー（stdio）。
// 標準出力はMCPの通信に使うので、ログは標準エラー出力にだけ出す。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { dataDirectory, publicError } from './core.mjs';
import { AirregiBrowser } from './browser.mjs';
import { createTools } from './tools.mjs';
import { REPORTS } from './reports.mjs';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD（日本時間）');
const jobId = z.string().uuid().describe('start_download が返した job_id');

export function createServer({ tools, version = '0.2.0' }) {
  const server = new McpServer({ name: 'airregi-csv', version });
  const wrap = fn => async args => {
    try {
      const value = await fn(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: publicError(e) }, null, 2) }] };
    }
  };
  const readOnly = { readOnlyHint: true, openWorldHint: true };

  server.registerTool('list_reports', {
    description: '取得できるエアレジの帳票の一覧を返します。verified が false の帳票は、画面の確認がまだで、取得が止まることがあります。',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap(() => tools.list_reports()));

  server.registerTool('status', {
    description: 'Chrome を開いているか、実行中の取得があるか、保存先のフォルダを返します。',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap(() => tools.status()));

  server.registerTool('open_login', {
    description: 'Chrome でエアレジのログイン画面を開きます。ログインは利用者が手動で行います。LOGIN_REQUIRED が返ったときに使います。',
    annotations: readOnly,
  }, wrap(() => tools.open_login()));

  server.registerTool('list_stores', {
    description: 'エアレジの店舗一覧を返します。ログインが切れていると LOGIN_REQUIRED を返します。',
    annotations: readOnly,
  }, wrap(() => tools.list_stores()));

  server.registerTool('start_download', {
    description: '指定した帳票のCSVを、店舗ごと・月ごとに取得して保存します。すぐに job_id を返すので、get_download で終わるまで確認してください。取得に失敗した店舗や期間を売上ゼロと扱わないでください。',
    inputSchema: {
      report: z.enum(REPORTS.map(r => r.id)).describe('帳票のID（list_reports で確認）'),
      stores: z.array(z.string().min(1)).min(1).describe('店舗名（list_stores で確認）'),
      from: date.describe('開始日 YYYY-MM-DD'),
      to: date.describe('終了日 YYYY-MM-DD（日本時間の今日以前）'),
      output_dir: z.string().optional().describe('保存先フォルダの絶対パス。省略するとデータフォルダの downloads の下に作ります'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, wrap(args => tools.start_download(args)));

  server.registerTool('get_download', {
    description: 'start_download の進み具合と結果を返します。status が running のあいだは、少し待ってからもう一度呼んでください。',
    inputSchema: { job_id: jobId },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap(args => tools.get_download(args)));

  server.registerTool('cancel_download', {
    description: '実行中の取得を止めます。取得済みのファイルは残ります。',
    inputSchema: { job_id: jobId },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, wrap(args => tools.cancel_download(args)));

  return server;
}

export async function main(env = process.env) {
  const dataDir = dataDirectory(env);
  const browser = new AirregiBrowser({ dataDir, headless: env.AIRREGI_HEADLESS === '1' });
  const server = createServer({ tools: createTools({ browser, dataDir }) });
  const shutdown = async () => { await browser.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  process.stdin.on('close', () => { browser.close().finally(() => process.exit(0)); });
  await server.connect(new StdioServerTransport());
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(self); } catch { return false; } })();
if (invoked) main().catch(e => { process.stderr.write(`airregi-csv: ${e?.message ?? e}\n`); process.exit(1); });
