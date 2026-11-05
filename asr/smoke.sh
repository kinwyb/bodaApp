#!/usr/bin/env bash
# 冒烟测试：健康检查 + 一句话识别
#   ./smoke.sh                用系统 TTS 现场造一段（macOS 自带 say）
#   ./smoke.sh 某个.wav       指定音频（wav/mp3/m4a/webm/opus 都行）
set -euo pipefail

BASE=${BASE:-http://127.0.0.1:9383}

if [ $# -ge 1 ]; then
  AUDIO=$1
else
  # 数字必须**逐位**念（三幺六幺八零零零幺）。数值读法（"三亿一千六百一十八万零一"）
  # 会被模型如实转写成汉字，那不是识别错误，是念法不同，测不出物料号能力。
  TMP=$(mktemp -d)
  AUDIO="$TMP/case.wav"
  say -o "$TMP/case.aiff" "新建一个包装bom，缝制物料三幺六幺八零零零幺，项目号是FT029，包装方法配比，包装数量62，辅料幺幺八幺四零零四四"
  ffmpeg -y -hide_banner -loglevel error -i "$TMP/case.aiff" -ar 16000 -ac 1 "$AUDIO"
fi

echo "== health =="
curl -s "$BASE/health"
echo
echo "== asr: $AUDIO =="
curl -s -X POST "$BASE/asr" -F "file=@${AUDIO}"
echo
