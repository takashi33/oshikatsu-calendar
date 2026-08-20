#!/usr/bin/env bash
# 推しごとカレンダーを GitHub Pages へ公開する。
#
# GitHub のページを開いて手作業する工程を置き換えるもの。認証は Windows 資格情報
# マネージャー（Git Credential Manager）に保存済みのものを使うので、ログインは不要。
# numerology-calculator/deploy.sh を元に、公開ファイルと公開先だけ差し替えてある。
#
#   使い方:  ./deploy.sh "コミットメッセージ"
#            ./deploy.sh --check      公開せず、差分の確認だけ行う
#
set -euo pipefail

cd "$(dirname "$0")"

PUBLISHED=(index.html sw.js manifest.webmanifest icon-192.png icon-512.png icon-512-maskable.png)
SITE="https://takashi33.github.io/oshigoto-calendar"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# ---- 0. 準備ができているか --------------------------------------------------
[ -d .git ] || die "まだ git リポジトリになっていません。先に初期設定を済ませてください。"
git remote get-url origin >/dev/null 2>&1 || die "origin が設定されていません。先に初期設定を済ませてください。"

# ---- 1. 公開対象がそろっているか -------------------------------------------
for f in "${PUBLISHED[@]}"; do
  [ -f "$f" ] || die "公開対象 $f が見つかりません。"
done

# index.html を変えたのに sw.js のキャッシュ版数を上げ忘れると、
# 利用者の端末に古い画面が残り続ける。公開前に機械で気づけるようにしておく。
APP_VER=$(grep -oP "APP_VERSION = '\K[^']+" index.html || true)
SW_VER=$(grep -oP "CACHE = 'oshi-cal-\K[^']+" sw.js || true)
if [ -n "$APP_VER" ] && [ "$APP_VER" != "$SW_VER" ]; then
  die "版数がずれています（index.html: $APP_VER / sw.js: $SW_VER）。
sw.js の CACHE を 'oshi-cal-$APP_VER' に直してください。
そろえないと、利用者の端末に古い画面が残り続けます。"
fi
echo "  版数: $APP_VER（index.html と sw.js で一致）"

# 壊れたものを公開しないための関所。node が無い環境では飛ばす。
if command -v node >/dev/null 2>&1 && [ -f test.js ]; then
  say "0/5 自動テスト"
  if ! node test.js; then
    die "テストが通りません。直してから公開してください。"
  fi
else
  echo "  ⚠️ node が無いためテストを飛ばしました"
fi

# ---- 2. リモートの状態を取り込む -------------------------------------------
say "1/5 リモートの状態を取得"
git fetch --quiet origin main

BEHIND=$(git rev-list --count HEAD..origin/main)
AHEAD=$(git rev-list --count origin/main..HEAD)
echo "  ローカル: origin より ${AHEAD} コミット先行 / ${BEHIND} コミット遅れ"

if [ "$BEHIND" -gt 0 ]; then
  if [ "$AHEAD" -gt 0 ]; then
    die "ローカルとリモートが分岐しています。手動で解決してください:
  git log --oneline --graph --all -20"
  fi
  say "  リモートが進んでいるので早送りします"
  git merge --ff-only origin/main
fi

# ---- 3. 差分を見せる --------------------------------------------------------
say "2/5 公開ファイルの差分"
if git diff --quiet -- "${PUBLISHED[@]}" && git diff --cached --quiet -- "${PUBLISHED[@]}"; then
  echo "  公開ファイルに変更はありません。"
else
  git diff --stat HEAD -- "${PUBLISHED[@]}"
fi

say "3/5 その他の変更"
OTHER=$(git status --short -- . ':!index.html' ':!sw.js' ':!manifest.webmanifest' ':!icon-192.png' ':!icon-512.png' ':!icon-512-maskable.png')
[ -n "$OTHER" ] && echo "$OTHER" || echo "  なし"

if [ "$CHECK_ONLY" -eq 1 ]; then
  say "--check のため、ここで終了します（何も公開していません）。"
  exit 0
fi

# ---- 4. コミットして push ---------------------------------------------------
if [ -z "$(git status --porcelain)" ]; then
  say "コミットする変更がありません。"
else
  MSG="${1:-Update oshigoto calendar}"
  say "4/5 コミット: $MSG"
  git add -A
  git commit --quiet -m "$MSG"
fi

say "5/5 push"
git push --quiet origin main
echo "  完了: $(git log --oneline -1)"

# ---- 5. 公開の反映を確認 ----------------------------------------------------
# push が通っても、公開に反映されるまで十数秒かかる。実物を取って中身を照合する。
# 「別プロジェクトのファイルを上げてしまった」事故を防ぐのが目的。
say "公開の反映を確認しています（最大90秒）"
LOCAL_HASH=$(tr -d '\r' < index.html | md5sum | cut -d' ' -f1)
for i in $(seq 1 18); do
  sleep 5
  LIVE_HASH=$(curl -fsSL -H 'Cache-Control: no-cache' "$SITE/index.html" 2>/dev/null | tr -d '\r' | md5sum | cut -d' ' -f1) || continue
  if [ "$LIVE_HASH" = "$LOCAL_HASH" ]; then
    printf '\n\033[32m公開を確認しました: %s/\033[0m\n' "$SITE"
    exit 0
  fi
  printf '.'
done

printf '\n\033[33mpush は成功しましたが、90秒以内に公開へ反映されませんでした。
GitHub Pages のビルド待ちの可能性があります。数分後に下記で再確認してください:
  curl -s %s/index.html | tr -d "\\r" | md5sum
  ローカル: %s\033[0m\n' "$SITE" "$LOCAL_HASH"
