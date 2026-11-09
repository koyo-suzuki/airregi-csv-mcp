# エアレジCSV取得MCP

エアレジの帳票CSVを取得する道具です。Claude CodeやClaude DesktopなどのAIからMCPサーバーとして使えるほか、自分で打つコマンドとしても使えます。帳票・店舗・期間を指定してCSVを保存します。集計はしません。MacとWindowsで動きます。

## 取得できる帳票

| ID | 帳票 | 画面 | 期間の選び方 | 画面の確認 |
|---|---|---|---|---|
| `variation_sales` | バリエーション別売上 | 商品別売上（バリエーション単位で表示） | カレンダー | 済み |
| `product_sales` | 商品別売上 | 商品別売上（商品単位で表示） | カレンダー | 済み |
| `daily_sales` | 日別売上（売上集計） | 日別売上 | 集計対象「日別」と年・月のプルダウン | 済み |
| `transaction_details` | 会計明細 | 日別売上 | 集計対象「日別」と年・月のプルダウン | 済み |

どの帳票も、1店舗・1か月分を実際に取得し、画面の数字と合うことを確かめました（2026年11月）。定義は `src/reports.mjs` にあります。

帳票ごとの制限は次のとおりです。

- `daily_sales` と `transaction_details` は、1か月単位でしか取得できません。開始日は月の1日、終了日は月末（今月なら今日）にしてください。合わない期間を指定すると、`start_download` は取得を始めずに `PERIOD_UNSUPPORTED` を返します。今月分のファイルは、エアレジが期間を月末までとして名前を付けます（中身は今日までです）。
- `transaction_details`（会計明細）は、エアレジの制限で、前月1日から今日までの分しか取得できません。
- `variation_sales` と `product_sales` は、エアレジの画面では約3年分を1回で出せました。ツールは月ごとに分けて取得します。

## はじめ方

[使い方（docs/usage.md）](docs/usage.md) に、AIごとの登録方法と、そのまま貼り付けて使えるプロンプトをまとめています。

必要なものは Node.js（22以上）、Git、Google Chrome です。Playwrightは、パソコンに入っているChromeを操作します。別のブラウザはダウンロードしません。

Claude Code、Codex CLI、Gemini CLI、Cursor のように、コマンドを実行できるAIなら、[使い方の「AIに入れてもらう」](docs/usage.md#2-aiに入れてもらう) の文を貼り付けるだけで、入れて登録まで済ませてくれます。

手で入れる場合は、リポジトリのフォルダで依存パッケージを入れてから、AIに登録します。Claude Code の例は次のとおりです。

```bash
npm ci --ignore-scripts
```

```bash
claude mcp add --scope user airregi-csv -- node C:\path\to\airregi-csv-mcp\src\mcp.mjs
```

Claude Desktop、Cursor、VS Code、Codex CLI、Gemini CLI の登録方法は、[使い方](docs/usage.md#aiごとの登録方法) にあります。

使うときは、AIに次のように頼みます。

```text
airregi-csv で、全店舗の先月の日別売上（daily_sales）のCSVを取ってきてください。終わったら、店舗ごとの結果と保存先のフォルダを教えてください。
```

## コマンドで使う

AIを通さずに、コマンドで取得することもできます。毎月決まった日に自動で取りたいときにも使えます。

```bash
node src/cli.mjs login
```

```bash
node src/cli.mjs download --report daily_sales --all-stores --last-month
```

オプションの一覧と、Windowsで毎月自動で取得する方法は、[使い方の「コマンドで使う」](docs/usage.md#コマンドで使う) にあります。

## MCPのツール

| ツール | 役割 |
|---|---|
| `list_reports` | 取得できる帳票の一覧を返します |
| `status` | Chromeを開いているか、実行中の取得があるか、保存先を返します |
| `open_login` | Chromeでエアレジのログイン画面を開きます |
| `list_stores` | 店舗の一覧を返します |
| `start_download` | 帳票・店舗・期間を指定して取得を始め、`job_id` を返します |
| `get_download` | 取得の進み具合と結果を返します |
| `cancel_download` | 実行中の取得を止めます |

取得には時間がかかるため、`start_download` はすぐに `job_id` を返します。終わったかどうかは `get_download` で確かめます。

期間は月ごとに分けて取得し、店舗×月ごとに1ファイルを保存します。一度に取得できるのは120ファイルまでです。

## ログイン

ログインは手動です。ログインが切れていると、ツールは `LOGIN_REQUIRED` を返します。そのときは `open_login` でChromeを開き、利用者がログインしてから、もう一度実行します。ログイン状態は保存先の `auth.json` に残り、次回から使われます。

自動でログインし直す機能は、まだありません。

## 結果の見方

`get_download` の `results` に、店舗×月ごとの結果が入ります。

| status | 意味 |
|---|---|
| `downloaded` | 保存しました |
| `header_only` | 保存しましたが、見出し行しかありません |
| `failed` | 取得できませんでした。`error` に理由があります |
| `not_attempted` | 前の処理で止まったか、中止したため、取得していません |

取得できなかった店舗や期間を、売上ゼロとして扱わないでください。全体の `status` は `completed`、`partial`、`failed`、`cancelled` のどれかです。

## 保存先

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\airregi-csv-mcp\` |
| Mac | `~/Library/Application Support/airregi-csv-mcp/` |

環境変数 `AIRREGI_APP_DATA` で変えられます。CSVは保存先の `downloads` の下に、取得ごとのフォルダを作って保存します。`start_download` の `output_dir` に絶対パスを渡すと、そのフォルダに保存します。各フォルダの `manifest.json` に、取得の結果を残します。

## 安全のための動き

- 画面の店舗名、期間、ダウンロードしたファイル名が指定と一致しなければ、保存せずに止めます。
- エアレジ以外の画面へ移動したら止めます。
- 想定外のエラーの中身は、AIへの返事に出しません。中身を見たいときは、環境変数 `AIRREGI_DEBUG=1` を付けると標準エラー出力に出ます。
- Macでは、保存したファイルを自分だけが読める権限にします。Windowsでは、ユーザーフォルダの権限で守ります。

## 開発

```bash
npm test
```

テストはChromeを起動しません。エアレジへの実際の取得は、利用者のパソコンで確かめます。CIでは、MacとWindowsでテストを回します。

要件は [docs/requirements.md](docs/requirements.md)、使い方は [docs/usage.md](docs/usage.md) にあります。
