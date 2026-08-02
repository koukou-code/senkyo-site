# 選挙区台帳

選挙区ごとに候補者を登録し、確実／優勢／接戦の印をつけて議席予想を積み上げる、個人用の記録ツールです。
サーバーを使わない静的サイトで、入力内容は閲覧者自身のブラウザ（localStorage）にだけ保存されます。

## 公開のしかた（GitHub Pages）

1. このフォルダの中身をリポジトリの直下に置いて push する
2. Settings → Pages → Source: `Deploy from a branch`、Branch: `main` / `(root)`
3. 数十秒後 `https://ユーザー名.github.io/リポジトリ名/` で公開される

ビルドは不要です。ローカルで確認したいときは `index.html` をブラウザで開くだけで動きます。

## ファイルの分担

| ファイル | 中身 | 触る頻度 |
| --- | --- | --- |
| `index.html` | 画面の骨組み（HTML） | 機能を足すとき |
| `assets/style.css` | 見た目 | 見た目を変えるとき |
| `js/config.js` | **サイト名・意見箱のURL・お知らせ** | よく触る |
| `js/data.js` | 政党プリセット、衆参の選挙区マスタ | 政党が変わったとき |
| `js/store.js` | データの保存・移行・集計・ドント式 | ロジックを足すとき |
| `js/render.js` | 画面の描画 | 表示を変えるとき |
| `js/image.js` | PNG出力 | 画像の体裁を変えるとき |
| `js/app.js` | ボタンなどの操作をつなぐ | 機能を足すとき |

読み込み順は `config → data → store → render → image → app` です。
ES Modules を使っていないので、`file://` で直接開いても動きます。

## お知らせ・意見箱の更新

`js/config.js` だけを書き換えて push すれば反映されます。

```js
window.DL_CONFIG = {
  siteName: "選挙区台帳",
  siteUrl: "https://example.github.io/district-ledger/",
  feedbackUrl: "https://docs.google.com/forms/d/e/XXXX/viewform", // 空なら意見箱ボタンは出ません
  contactLabel: "X（旧Twitter）",
  contactUrl: "https://x.com/xxxx",
  announcements: [
    { date: "2026-08-10", title: "○○選挙に対応しました", body: "説明文" }
  ]
};
```

意見箱は Google フォームを想定しています。フォーム側に「不具合／要望／その他」の選択肢と自由記述欄、
再現手順（使った端末・ブラウザ）の欄を作っておくと処理が楽です。

## 政党の更新

`js/data.js` の `PARTY_PRESET` が初期値です（2026年8月時点の顔ぶれ）。
すでに使っている人のブラウザには初期値が入ったあとなので、プリセットを書き換えても既存利用者には反映されません。
利用者側は画面の「政党を管理」から自分で追加・改名・色変更ができます。

## データの構造

```
{
  version: 4,
  parties: [{ name, color }],
  activeElectionId,
  elections: [{
    id, name, type: "multi" | "single",
    majority,             // 過半数ライン
    proportionalTotal,    // 比例の総定数
    proportional: [{ id, party, seats, votes }],
    partyGoals: { 政党名: 目標議席 },
    blocs: [{ id, name, parties[], color, goal }],
    districts: [{ id, group, label, seatCount,
      candidates: [{ id, name, party, terms, memo, incumbent }],
      winners: [{ id, level: "sure"|"lean"|"toss" }] }]
  }]
}
```

`district-ledger-v1` 〜 `v3` の保存データは起動時に自動で `v4` へ変換されます。
