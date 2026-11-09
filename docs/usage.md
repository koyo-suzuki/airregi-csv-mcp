# 使い方

このツールは、AIから使うMCPサーバー（stdio）と、自分で打つコマンドの2つの形で使えます。中身は同じです。

MCPサーバーは、パソコンの中で動きます。Claude Code、Claude Desktop、Cursor、VS Code（GitHub Copilot）、Codex CLI、Gemini CLI など、ローカルのMCPサーバーに対応したAIから使えます。

ChatGPT（Webとアプリ）は、パソコンの中で動くMCPサーバーに直接つなげないため、このままでは使えません。

## 最初にやること

### 1. 必要なものを入れる

- [Node.js](https://nodejs.org/)（22以上）
- [Git](https://git-scm.com/)
- Google Chrome

### 2. AIに入れてもらう

Claude Code、Codex CLI、Gemini CLI、Cursor のように、コマンドを実行できるAIなら、次の文を貼り付けるだけで入れてもらえます。

```text
エアレジのCSVを取得するMCPサーバー「airregi-csv」を、このパソコンに入れて、あなた（このAI）から使えるように登録してください。

1. 消えない場所にフォルダを決めてください。Windows なら %USERPROFILE%\airregi-csv-mcp、Mac なら ~/airregi-csv-mcp にしてください。一時フォルダやセッション用のフォルダは使わないでください。
2. そのフォルダに https://github.com/koyo-suzuki/airregi-csv-mcp.git を clone してください。すでにある場合は、git pull で最新にしてください。
3. フォルダの中で npm ci --ignore-scripts と npm test を実行し、テストがすべて通ることを確かめてください。
4. あなた自身のMCPの設定に、次のサーバーを「airregi-csv」という名前で、どのフォルダからでも使える範囲（ユーザー全体）で登録してください。
   - コマンド：node
   - 引数：<1で決めたフォルダの絶対パス>/src/mcp.mjs（Windows では区切りを \ にしてください）
   登録の方法がわからなければ、docs/usage.md の「AIごとの登録方法」を読んでください。
5. 登録できたか確かめてください。すぐに使えない場合は、私が何をすれば使えるようになるか（再起動など）を教えてください。
6. Node.js、Git、Google Chrome のどれかが入っていなければ、作業を止めて、入れ方を教えてください。

エアレジへのログインは、私が手で行います。パスワードを聞いたり、代わりに入力したりしないでください。
```

Claude Desktop のように、コマンドを実行できないAIでは、下の「AIごとの登録方法」を見て、自分で設定してください。

### 3. AIを起動し直す

登録したMCPサーバーは、多くのAIで、起動し直したあとに使えるようになります。

## AIごとの登録方法

例では、リポジトリを次の場所に置いたとします。自分の場所に置き換えてください。

- Windows：`C:\Users\you\airregi-csv-mcp`
- Mac：`/Users/you/airregi-csv-mcp`

JSONの中で Windows のパスを書くときは、`\` を `\\` と2つ重ねます。

### Claude Code

```bash
claude mcp add --scope user airregi-csv -- node C:\Users\you\airregi-csv-mcp\src\mcp.mjs
```

`claude mcp list` で `airregi-csv` が `Connected` になっていれば使えます。

### Claude Desktop

設定ファイルに次の内容を足して、Claude Desktop を起動し直します。

- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- Mac：`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "airregi-csv": {
      "command": "node",
      "args": ["C:\\Users\\you\\airregi-csv-mcp\\src\\mcp.mjs"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`（Windows では `%USERPROFILE%\.cursor\mcp.json`）に、Claude Desktop と同じ形の内容を書きます。

### VS Code（GitHub Copilot）

コマンドパレットで「MCP: Open User Configuration」を開き、次の内容を足します。

```json
{
  "servers": {
    "airregi-csv": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Users\\you\\airregi-csv-mcp\\src\\mcp.mjs"]
    }
  }
}
```

Copilot Chat をエージェントモードにすると使えます。

### Codex CLI

`~/.codex/config.toml`（Windows では `%USERPROFILE%\.codex\config.toml`）に、次の内容を足します。

```toml
[mcp_servers.airregi-csv]
command = "node"
args = ['C:\Users\you\airregi-csv-mcp\src\mcp.mjs']
```

### Gemini CLI

`~/.gemini/settings.json`（Windows では `%USERPROFILE%\.gemini\settings.json`）に、Claude Desktop と同じ形の内容を書きます。

## 使うときのプロンプト

貼り付けて、店舗名や期間だけ書き換えて使ってください。

### はじめて使うとき

```text
airregi-csv で、エアレジの店舗一覧を出してください。ログインが必要なら open_login でログイン画面を開いてください。私が手でログインしたら声をかけるので、それまで待ってください。
```

### 先月の日別売上を全店舗分

```text
airregi-csv で、全店舗の先月の日別売上（daily_sales）のCSVを取ってきてください。店舗は list_stores で確かめてください。取得を始めたら、終わるまで get_download で進み具合を確かめて、最後に店舗ごとの結果と保存先のフォルダを教えてください。
```

### 期間と帳票を指定して

```text
airregi-csv で、「〇〇店」と「△△店」の、2026年1月から3月までの商品別売上（product_sales）のCSVを、C:\Users\you\Documents\エアレジ に保存してください。終わったら、取れなかった店舗や月があるかを教えてください。
```

### 会計明細

```text
airregi-csv で、全店舗の今月の会計明細（transaction_details）のCSVを取ってきてください。
```

会計明細は、前月1日以降の分しか取れません（エアレジの制限）。

### AIに守ってほしいこと（どのプロンプトにも付け足せます）

```text
取得に失敗した店舗や月は、売上ゼロとして扱わないでください。失敗したものは、理由と一緒に一覧で教えてください。
```

## コマンドで使う

AIを通さずに、自分でコマンドを打って取得することもできます。中身はMCPサーバーと同じです。決まった日に自動で取得したいときにも使います。

以下の例では、リポジトリを `C:\Users\you\airregi-csv-mcp` に置いたとします。自分の場所に置き換えてください。

### 主なコマンド

最初に一度、ログインします。Chrome が開くので、手でログインしてください。ログインし終わると、コマンドが自動で終わります。

```bash
node C:\Users\you\airregi-csv-mcp\src\cli.mjs login
```

全店舗の先月の日別売上を取得します。

```bash
node C:\Users\you\airregi-csv-mcp\src\cli.mjs download --report daily_sales --all-stores --last-month
```

店舗と月を指定して、保存先も決めます。

```bash
node C:\Users\you\airregi-csv-mcp\src\cli.mjs download --report product_sales --store "〇〇店" --store "△△店" --month 2026-10 --out C:\airregi\product
```

ほかのコマンドと、オプションの一覧は次のとおりです。

| コマンド | やること |
|---|---|
| `reports` | 取得できる帳票の一覧 |
| `stores` | 店舗の一覧 |
| `login` | ログイン画面を開き、ログインし終わるまで待つ |
| `download` | CSVを取得する |

| オプション | 意味 |
|---|---|
| `--report <ID>` | 帳票のID（`daily_sales` など） |
| `--store <店舗名>` | 店舗。何回でも付けられます |
| `--all-stores` | 全店舗 |
| `--last-month` | 先月の1日から月末まで |
| `--this-month` | 今月の1日から今日まで |
| `--month <YYYY-MM>` | 指定した月 |
| `--from <日付>` と `--to <日付>` | 開始日と終了日（YYYY-MM-DD） |
| `--out <フォルダ>` | 保存先 |
| `--json` | 結果をJSONで出す |
| `--headless` | Chrome の画面を出さずに動かす（`login` では使えません） |

`--help` を付けると、説明が出ます。

### `airregi-csv` だけで打てるようにする（任意）

毎回 `node` と長いパスを書くのが面倒なら、リポジトリのフォルダで次のコマンドを一度実行します。

```bash
npm install -g .
```

そのあとは、`airregi-csv download --report daily_sales --all-stores --last-month` のように打てます。

### 終了コード

自動で動かすときに、うまくいったかを判断するのに使います。

| 終了コード | 意味 |
|---|---|
| 0 | すべて取得できました |
| 2 | 一部だけ取得できました |
| 3 | ログインが必要です。`login` を実行してください |
| 1 | そのほかの理由で取得できませんでした |
| 64 | コマンドの書き方が間違っています |

### 毎月自動で取得する（Windows）

1. 次の内容で `C:\airregi\monthly.cmd` を作ります。保存先とログのフォルダは、日本語を含まない場所にしてください。

```bat
@echo off
node C:\Users\you\airregi-csv-mcp\src\cli.mjs download --report daily_sales --all-stores --last-month --headless --out C:\airregi\daily >> C:\airregi\log.txt 2>&1
node C:\Users\you\airregi-csv-mcp\src\cli.mjs download --report transaction_details --all-stores --last-month --headless --out C:\airregi\transactions >> C:\airregi\log.txt 2>&1
```

2. PowerShell で次のコマンドを実行し、毎月1日の朝9時に動くよう登録します。

```bash
schtasks /Create /TN "airregi-csv monthly" /SC MONTHLY /D 1 /ST 09:00 /TR "C:\airregi\monthly.cmd"
```

- その時刻にパソコンが起動していて、Windows にサインインしている必要があります。
- `--headless` を付けているので、Chrome の画面は出ません。裏で自動で操作します。
- ログインが切れていると、取得できずに `C:\airregi\log.txt` に「ログインが必要です」と残ります。そのときは `login` を実行してから、`monthly.cmd` をダブルクリックして取り直します。
- 会計明細は前月1日以降しか取れないので、毎月取っておくと、あとから取れなくなる心配がありません。

## 帳票と期間の決まり

| ID | 帳票 | 期間 |
|---|---|---|
| `variation_sales` | バリエーション別売上 | 自由。月ごとに分けて保存します |
| `product_sales` | 商品別売上 | 自由。月ごとに分けて保存します |
| `daily_sales` | 日別売上 | 月の1日から月末まで（今月は今日まで） |
| `transaction_details` | 会計明細 | 月の1日から月末まで。前月1日以降だけ |

一度に取得できるのは、店舗数×月数で120ファイルまでです。

## 困ったとき

| 起きたこと | やること |
|---|---|
| `LOGIN_REQUIRED` が返る | AIに `open_login` を頼み、開いたChromeで手でログインしてから、もう一度頼みます |
| `CHROME_MISSING` が返る | Google Chrome を入れます |
| `PERIOD_UNSUPPORTED` が返る | 日別売上と会計明細は、期間を月の1日から月末にします。会計明細は前月1日以降にします |
| `BUSY` が返る | 前の取得が終わるまで待ちます |
| `DOWNLOAD_NAME_MISMATCH` や `BROWSER_CHANGED` が返る | エアレジの画面が変わった可能性があります。`src/reports.mjs` の定義を直す必要があります |
| AIがツールを見つけられない | AIを起動し直します。それでもだめなら、登録したパスが正しいかを確かめます |

ログイン状態は、Windows では `%APPDATA%\airregi-csv-mcp\auth.json`、Mac では `~/Library/Application Support/airregi-csv-mcp/auth.json` に残ります。このファイルを人に渡さないでください。

## 最新にする

リポジトリのフォルダで、次のコマンドを順に実行します。終わったらAIを起動し直します。

```bash
git pull
```

```bash
npm ci --ignore-scripts
```
