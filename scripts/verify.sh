#!/bin/sh
# verify 一次性服务入口：代码测试 → 构建检查 → 规定场景断言 → HTTP 冒烟。
# 任一步失败立即以非零退出码退出，由 compose 报告该服务失败。
set -eu

echo '== [1/4] 代码测试（vitest） =='
npm test -- --run

echo '== [2/4] 构建检查（tsc + vite build） =='
npm run build

echo '== [3/4] 规定场景断言：吸收律 / 共享子门归属 / complexity_limit =='
mkdir -p .verify
npx esbuild scripts/verify-scenarios.ts \
  --bundle --platform=node --format=esm --outfile=.verify/scenarios.mjs
node .verify/scenarios.mjs

echo '== [4/4] HTTP 冒烟（web 服务 /healthz 与 /） =='
# compose 的 service_healthy 已保证就绪，这里仍做有限重试以保留独立运行能力。
ready=0
i=0
while [ "$i" -lt 30 ]; do
  if wget -q -O- "http://${WEB_HOST:-web}/healthz" >/dev/null; then ready=1; break; fi
  i=$((i + 1))
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo 'healthz 在重试窗口内不可用' >&2
  exit 1
fi
wget -q -O- "http://${WEB_HOST:-web}/healthz" | grep -q '^ok$'
wget -q -O- "http://${WEB_HOST:-web}/" | grep -q 'id="root"'
echo "healthz: $(wget -q -O- "http://${WEB_HOST:-web}/healthz")"

echo ''
echo 'ALL VERIFY CHECKS PASSED'
