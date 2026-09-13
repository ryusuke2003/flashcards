# 単語帳

Google Sheets をデータベースとして使う、個人用のシンプルな単語帳 Web アプリです。

Mac と iPhone で同じ Google アカウントから同じ Web アプリを開けば、カード・正誤回数・復習日・苦手情報が同じ Google Sheet に保存されるため、そのまま同期されます。

## 主な機能

- CSV でカードを一括登録
- `type` 列をデッキ名として利用
- 起動時にデッキを選択して別々に学習
- Mac / iPhone で同じ学習状態を共有
- 正解 / 不正解を記録
- Leitner 方式による復習スケジュール
- 今日間違えた問題だけ復習
- 苦手な問題を重点復習
- 要確認フラグ
- アプリ上から問題・答え・メモを編集
- ダークモード / ライトモード対応
- 外部データベース不要
- 外部 JavaScript ライブラリ不要

この fork は日本語での学習用途に絞った版です。元リポジトリに含まれていたオランダ語・中国語向けスターターデッキ、多言語音声読み上げ、学習言語設定、Soak プレイヤー、利用状況を送る更新チェック機能は削除しています。

## 仕組み

```text
Mac のブラウザ ─┐
                  ├─ Google Apps Script ─ Google Sheets
iPhone Safari ───┘
```

端末同士が直接同期するのではなく、両方が同じ Google Sheet を読み書きします。

## デッキの分け方

`cards` シートの `type` 列をデッキ名として扱います。

たとえば次のように登録すると、アプリ起動時に「A1」と「セキスペ」が別々のデッキとして表示されます。

```csv
id,type,front_side,back_side,notes,box,due,last_seen,right,wrong,added,flag,exclude,last_wrong
1,A1,IRRとは？,内部収益率,,,,,,,,,,
2,A1,NPVとは？,正味現在価値,,,,,,,,,,
3,セキスペ,Forward Secrecyとは？,長期鍵が漏えいしても過去の通信内容を復号しにくくする性質,,,,,,,,,,
4,セキスペ,EAP-TLSとは？,クライアント証明書とサーバ証明書を用いるEAP方式,,,,,,,,,,
```

アプリでは概ね次のように表示されます。

```text
デッキを選択

A1                  616枚
今日の復習 20 ・ 未学習 100 ・ 今日の間違い 3

セキスペ            215枚
今日の復習 10 ・ 未学習 40 ・ 今日の間違い 2
```

選択後の「通常学習」「今日間違えた問題だけ復習」「苦手な問題を重点復習」は、すべて選択したデッキ内だけで行われます。

`type` が空欄のカードは「未分類」デッキにまとめられます。

## セットアップ

### 1. clone

```bash
git clone https://github.com/ryusuke2003/flashcards.git
cd flashcards
```

### 2. clasp

```bash
npm install -g @google/clasp
clasp login
```

### 3. Sheet に紐づく Apps Script プロジェクトを作成

```bash
clasp create --type sheets --title "単語帳" --rootDir .
git checkout -- appsscript.json
```

### 4. デプロイ

```bash
clasp push --force
clasp deploy --description "日本語版"
```

表示された Deployment ID を使って Web アプリを開きます。

```text
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

デフォルトは `access: MYSELF` なので、自分の Google アカウントだけが利用できます。

## iPhone で使う

Safari で Web アプリを開き、共有メニューから「ホーム画面に追加」を選びます。

## CSV の取り込み

アプリ自身は CSV をアップロードしません。Google Sheets のインポート機能を使います。

1. Web アプリから Google Sheets を開く
2. `cards` シートを開く
3. ファイル → インポート → アップロード
4. CSV を選択
5. 新規なら現在のシートを置換、既存カードを残すなら現在のシートに追加
6. 「テキストを数値、日付、数式に変換する」はオフ

6 はセキュリティ上も重要です。CSV 内の `=...` などが Google Sheets の数式として解釈されるのを防ぎます。アプリ上から編集した値についても、数式として評価されないプレーンテキストとして保存します。

### 必須ヘッダー

```csv
id,type,front_side,back_side,notes,box,due,last_seen,right,wrong,added,flag,exclude,last_wrong
```

### 最小例

```csv
id,type,front_side,back_side,notes,box,due,last_seen,right,wrong,added,flag,exclude,last_wrong
1,A1,IRRとは？,内部収益率,,,,,,,,,,
2,セキスペ,ARPの役割は？,IPv4でIPアドレスからMACアドレスを調べること,同一L2ネットワーク内で利用,,,,,,,,,
```

`decks/template.csv` も雛形として使えます。

## 学習モード

通常学習では、選択中のデッキについて、復習期限が来たカードと未学習カードを出題します。

- 正解: box を1段階上げる
- 不正解: box 1へ戻す
- box 1〜5 の復習間隔: 1 / 2 / 4 / 8 / 16 日

「今日間違えた問題だけ復習」と「苦手な問題を重点復習」も、選択中のデッキ内だけを対象にします。これらは通常スケジュールを変更しない練習モードです。

## セキュリティ上の方針

- Web アプリのアクセス範囲は `MYSELF`
- `@OnlyCurrentDoc` で Spreadsheet 権限をこの単語帳のシートに限定
- `XFrameOptionsMode.ALLOWALL` を使用しない
- カード本文やデッキ名は `textContent` で表示し、HTMLとして解釈しない
- 外部 JavaScript / CDN を読み込まない
- 編集したカード本文は `RichTextValue` でプレーンテキストとして保存し、`=...` を数式として実行させない
- CSV 取り込み時は「テキストを数値、日付、数式に変換する」をオフにする
- 元リポジトリにあった匿名利用状況の送信・更新チェックを削除

## 更新

```bash
clasp push --force
clasp redeploy <DEPLOYMENT_ID> --description "update"
```

## ライセンス

MIT License
