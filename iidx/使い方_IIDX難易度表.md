# beatmania IIDX クリア難易度表 自動記入ツール（個人カスタマイズ版）

## ファイル
| ファイル | 内容 |
|---|---|
| `iidx/iidxTable.js` | ブックマークレット本体 |
| `iidx/tables.json` | 難易度表データ（下の7つの表をまとめたもの） |
| `iidx/preview.html` | PCでの表示確認用（ダミーデータ） |

## 収録している難易度表（SP）
| タブ | ☆ | 元の表 |
|---|---|---|
| ノマゲ以下 | ☆9 / ☆10 | ⅡDX ☆9,10ノマゲ以下クリア難易度表（スプレッドシート） |
| ノマゲ以下 | ☆11 | record.iidx.app 「☆11ノマゲ難易度表」(sheets/43) |
| ノマゲ以下 | ☆12 | record.iidx.app 「SP☆12 ノマゲ参考表」(sheets/1) |
| ハード | ☆11 | record.iidx.app 「SP☆11 ハード難易度表」(sheets/98) |
| ハード | ☆12 | record.iidx.app 「SP☆12 ハード参考表」(sheets/2) |
| エクハ | ☆12 | record.iidx.app 「SP☆12 エクハ参考表」(sheets/139) |

## ブックマークレット
```
javascript: import("https://yuma0728.github.io/Bookmarklet/iidx/iidxTable.js?" + Date.now()).then(m => m.default());
```

## 使い方
1. IIDXの公式サイト（e-amusement）にログインする
2. ブックマークを開く（Chromeではアドレス欄にブックマーク名を入力して候補から選ぶ）
3. 初回は ☆9～12 のプレイデータを取得する（1ページ50譜面ずつ、少し時間がかかります）
4. プレイした後は画面下の「データを更新」を押す

## 表示のルール
- 上から「タイトル・取得日」→「目的（ノマゲ以下 / ハード / エクハ）」→「☆」→「すべて / 達成済み / 未達成 / 未プレイ」
- 達成の判定: ノマゲ以下 = ASSIST CLEAR 以上、ハード = HARD CLEAR 以上、エクハ = EX HARD CLEAR 以上（達成した譜面には ✓）
- 各マスの色 = 現在のクリアランプ（FULL COMBO / EX HARD / HARD / CLEAR / EASY / ASSIST / FAILED / NO PLAY）
- マスの中: 譜面の種類（N/H/A/L）、DJ LEVEL、EXスコア、ランプ名
- 左のラベル: ランク名と達成数。斜線入りのラベルは「個人差」
- 難易度表と公式サイトで曲名の表記が違う譜面は、画面下の「公式データと照合できなかった譜面」に出ます

## 難易度表を新しくしたいとき
元の表が更新されたら、Claude に `tables.json` の作り直しを頼んでください。
