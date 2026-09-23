# 航天器供电故障树 · 最小割集审计页

纯浏览器运行的 TypeScript + React 单页应用：对共享故障树（有向无环图）精确展开
**包含极小割集**，合并重复集合、按吸收律消去所有真超集，按事件标识排序输出顶事件割集，
并把基本事件归为 **必现 / 可选 / 无关**。

- 无业务后端、无任何在线调用：构建产物为纯静态文件（React/Vite 本地打包，无 CDN）。
- 静态 Web 由 Dockerfile 多阶段构建（nginx 托管），通过 Docker Compose 发布。
- 宿主机端口可通过 `WEB_PORT` 配置；提供 `/healthz` HTTP 健康检查。
- Compose 中名为 `verify` 的一次性服务执行：代码测试 → 构建检查 → 规定场景断言 → HTTP 冒烟，
  完成后自行退出，并用退出码报告结果。

## 输入语法

基本事件（2–30 个，每行一个唯一 ASCII 标识，`#` 起始为注释）：

```
BUS_FAULT
MAIN_SRC
# 标识规则：字母/下划线开头，仅含字母、数字、下划线
```

门（1–80 个，每行：`名称 AND|OR 输入...`，输入可为基本事件或其他门）：

```
LOSS   OR  COMMON_CTRL BUS_FAULT
MAINF  AND OR_MAIN LOSS
TOP    AND MAINF BKF
```

顶事件：单个门名称。

## 语义说明

- **AND 门**的割集：从每个输入的割集中各取一个并做并集（合取）。
- **OR 门**的割集：所有输入割集的并集（析取）。
- 规范化结果合并重复集合，并删除所有真超集（吸收律：`{A}` 吸收 `{A,B}`）。
- 共享子门经记忆化**仅规范化一次**，不随路径重复计算；事件归属基于顶事件最终割集：
  - 必现：出现在**每个**最小割集中（所有割集的交集）；
  - 可选：出现在部分割集中（并集减交集）；
  - 无关：不出现在任何割集中。

## 非法输入与定位

非法输入会原样保留在编辑器中，不被清空或改写。系统一次性诊断并支持点击定位：

- 非法 / 重复标识、数量越界、门语法或类型错误；
- 缺失引用（目标既非基本事件也非门）；
- 自引用（门直接引用自己）；
- 任意长度的环（Tarjan 强连通分量，给出具体环路径）；
- 顶事件不是已定义的门、门名与事件同名冲突。

## 复杂度上限（complexity_limit）

**任一门在其最终规范化族**上产生超过 2000 个最小割集时，结果状态为 `complexity_limit`，
并定位到首个超限的门（名称 + 行号）。此时**不会**输出顶事件割集或事件归属——
因为截断结果可能遗漏更小的解释，不允许冒充完整结论。

上限只对门的**最终**极小族判定：即使展开中途的原始组合数巨大（如与“全集”单割集
相并后坍缩为 1 个割集），只要最终族 ≤ 2000 仍给出完整结果。

## 本地开发（无需 Docker）

```bash
npm ci
npm test          # vitest 单元/组件测试
npm run build     # tsc 类型检查 + vite 生产构建
npm run dev       # 本地预览
```

## Docker Compose

```bash
# 启动静态 Web（默认宿主机端口 8080）
docker compose up -d --build web
# 自定义宿主机端口
WEB_PORT=9090 docker compose up -d --build web
# 或复制 .env.example 为 .env 后修改 WEB_PORT

curl -s http://localhost:8080/healthz   # => ok
```

### verify 一次性服务

```bash
docker compose run --build verify
# 等价地：docker compose up --build verify（web 健康后才执行）
```

`verify` 服务内的 `scripts/verify.sh` 依次执行：

1. `npm test` 代码测试；
2. `npm run build` 构建检查（tsc + vite build）；
3. `scripts/verify-scenarios.ts` 规定场景断言：
   - 吸收律：`A∨B∨(A∧B)` 最小割集恰为 `{A},{B}`；
   - 共享子门的事件归属（可选/无关）与共享门仅规范化一次；
   - 超限场景：`3^7=2187 > 2000` 报 `complexity_limit`，且边界 `2000` 完整输出；
4. HTTP 冒烟：对 `web` 服务的 `/healthz` 与 `/` 做就绪重试与内容断言。

全部通过退出码为 0 并自行退出；任一步失败退出码非零。

## 目录结构

```
src/core/
  types.ts      # 数据模型与结果状态（complete / complexity_limit / invalid）
  parser.ts     # 事件/门/顶事件文本解析（保留非法行与行号）
  validate.ts   # 缺失引用、自引用、Tarjan 环检测、命名冲突
  engine.ts     # 位掩码割集展开、吸收律消超集、每门 2000 上限、事件归属
  pipeline.ts   # 解析 → 校验 → 分析 编排
  *.test.ts     # 核心算法测试（26 项）
src/App.tsx     # 编辑器、问题定位、结果与截断警示 UI
src/App.test.tsx# 页面渲染/非法输入/截断 组件测试（3 项）
scripts/        # verify 一次性服务脚本
nginx.conf      # 静态托管 + /healthz
Dockerfile      # deps / builder / verify / runtime 多目标
docker-compose.yml
```
