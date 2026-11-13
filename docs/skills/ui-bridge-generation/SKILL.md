---
name: ui-bridge-generation
description: 为 bodaWay 页面生成、补全或审查 bridged.ts 界面桥。用户要求让 agent 观察或操作某页面，接入页面桥/弹窗桥，补 query、table、form、action、event、waitConfirm、ready，或排查桥已注册但导航、快照、命令、回执异常时使用。
---

# UI Bridge Generation

目标不是“让 `bridged.ts` 文件存在”，而是让 agent 能安全地看懂当前页面、读取真实数据、执行页面已有的全部能力，并得到可行动的回执。

## 开工前

1. 确认页面目录与 View，例如 `src/pages/views/V0189/V0279/V0280` -> `V0189_V0279_V0280`。页面从 props 拿到 `view` 后原样传给桥。
2. 先读现有 `index.tsx`、`columns.ts`、`command/`、`models/`，判断页面实际拥有哪些查询、表格、命令和弹窗。
3. 页面已存在就做增量，不重写；接口 DTO、字段名和权限沿用页面现状。
4. 只改页面私有目录。不要为了接桥擅自修改 `src/components/**` 或桥的公共实现。

按任务读取 references：

| 任务 | 必读 |
| --- | --- |
| 生成/补全页面级 `bridged.ts` | [references/page-bridge.md](references/page-bridge.md) |
| 表单弹窗使用 `useUIBridgeDialog`、`form.*`、明细批量写入 | [references/dialog-bridge.md](references/dialog-bridge.md) |
| 设计 actions、事件、`waitConfirm`、rev/full/patch/result | [references/events-and-receipts.md](references/events-and-receipts.md) |
| 交付前逐项核对 | [references/checklist.md](references/checklist.md) |
| 需要完整骨架 | [assets/page-bridged.template.ts](assets/page-bridged.template.ts)、[assets/dialog-bridge.template.ts](assets/dialog-bridge.template.ts) |

## 核心不变量

- **页面目录下的 `bridged.ts` 是接入标记**。没有它，页面不会进入 agent 导航；注册了 `useUIBridgeHost` 却漏文件时，开发期控制台会报错。
- **`bridged.ts` 只放常量与纯函数**。不导出组件，不调 React hook，不持有会过期的状态快照。
- **宿主存 getter**。页面传入 `read: () => context`，桥在被调用那一刻读取最新 state、ref、命令和表单。不要在创建 bridge 时把 state 拷成一份。
- **快照是目录，不是数据**。表格只给 `name/rowKey/columns/total/sorts/filters/selection`；行数据用 `<表名>.page` 或 `<表名>.row` 按需取。
- **动作只能有一个来源**。页面命令来自 `CommandItem`，表格命令来自 `createTableBridge`，字段命令来自 `createFormWriteActions`。不要另写一份平行命令表。
- **页面不处理协议细节**。rev、结构指纹、full/patch/result、事件抑制、弹窗覆盖都由公共桥处理。页面只描述当前视野和命令语义。
- **`guide.summary` 是菜单描述唯一来源**。`description.md` 由 `scripts/sync-menu-descriptions.mjs` 自动生成，不要手改。

## 工作流

### 1. 建模页面视野

列出 agent 此刻需要知道的东西：

- `guide.summary/steps/terms/cautions`：页面功能、硬顺序、业务术语、陷阱。
- `query`：改完会重新请求后端的页面级查询条件。日期 / 数值这类区间条件**一项拆成起止两项**，
  不能压成单个值（见 page-bridge.md「日期与数值区间」）。
- `tables[]`：集合固定的所有表；单表也用数组。
- `actions`：用户能点的业务命令与通用读/筛选/选中命令。
- `events`：只声明真实用户交互需要主动通知 agent 的事件。

### 2. 生成页面桥

使用 `createTableBridge` 接管列目录、行号取数、主键取整行、选中、筛选和枚举候选值。页面只补：

- 业务 `query.set`；
- `CommandItem` 到 `UIAction` 的映射；
- 业务事件；
- 必要时给 `visible`、`readable`、`active`、`selection` 覆盖值；
- 页面结构真正依赖异步数据时才给 `ready()`。

### 3. 接入页面

页面里保持三行式装配：

```tsx
const bridgeContext = useMemo<XxxBridgeContext>(() => ({view, ...latestStateAndReaders}), [deps]);
const bridge = useMemo(() => createXxxBridge(() => bridgeContext), [bridgeContext]);
useUIBridgeHost(view, bridge);
```

### 4. 接入弹窗

每个弹窗独立声明自己的字段、锁、命令、`detail.*` 与提交语义，并使用 `useUIBridgeDialog(view, host, open)` 仅在打开期间注册。不要在页面 `bridged.ts` 里转述弹窗。

### 5. 校验

先运行结构审计：

```bash
node <skill目录>/scripts/audit_bridge.mjs V0189_V0279_V0280
```

再运行项目检查：

```bash
npm run menu:descriptions
npx tsc -b
npx oxlint <本次修改文件>
```

最后按 [references/checklist.md](references/checklist.md) 做语义检查。静态审计通过不代表业务语义正确。

## 常见失败

- 页面注册了桥，但没有 `bridged.ts`，所以导航不可见。
- 快照塞了数据行，或拿页面 `dataSource` 当显示行，导致“第 N 条”与用户屏幕不一致。
- 页面复制了一份 `columns` 或 `CommandItem`，界面改了而桥没改。
- `query.set` 只 setState 就返回，不等待请求落地，补丁里的行数仍是旧值。
- 日期区间只给一个参数（`YPDate`）：页面控件是 `RangePicker`、存 `{min, max}`，用户筛的一段在桥里只剩一天。
  区间要拆成 `xxxFrom` / `xxxTo` 两项，页面侧两端都读写（见 page-bridge.md「日期与数值区间」）。
- 页面只有筛选面板（没有查询表单）却在桥里另造 `query`：同一批条件两条路，枚举列在 `query` 里没有候选值，
  `query.set` 还会把用户筛的其它列冲掉。这种页面**不发布 query**，全走 `filterType`。
- `applyQuery` 只 `setQuery`、不回写查询控件：列表换了、查询条还是旧值，用户一点「查询」就覆盖回去。
- `ready()` 等首屏接口，导航被慢接口拖到超时。列表快照不需要等数据行。
- 删除/发布只弹确认框，却把回执写成“已完成”。
- 表单逐字段写 16 次，而不是 `form.setMany` 一次写入。
- 弹窗字段表与 JSX/锁规则各维护一份，界面锁了但 agent 仍能写。
- 事件在 `ui_act` 回调或渲染期间自动触发，而不是只在真实用户交互中触发。
