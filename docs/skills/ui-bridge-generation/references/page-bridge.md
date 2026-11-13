# 页面级界面桥

## 文件职责

```text
<页面目录>/
  index.tsx      页面状态、布局、ref、useUIBridgeHost(view, bridge)
  columns.ts     页面与桥共用的列定义
  command/       CommandItem 来源
  bridged.ts     guide + 快照形状 + handlers，纯函数与常量
  description.md 由 guide.summary 自动生成，不手改
```

`bridged.ts` 不导出组件，不调 hook，不 import React。

## 最小页面桥

```ts
export type XxxBridgeContext = {
    view: string;
    query: XxxQuery;
    applyQuery: (next: XxxQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

export function createXxxBridge(read: () => XxxBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: ['OrderCode', 'Qty', 'WorkPlace'],
        columnHints: {WorkPlace: '可选值：越南工厂 / 义乌工厂'},
    });

    return {
        snapshot: () => ({
            view: read().view,
            title: '一级菜单 > 二级菜单',
            mode: 'list',
            guide: GUIDE,
            actions: [...tableBridge.actions(), querySetAction()],
            query: currentQuery(read().query),
            tables: [tableBridge.data()],
        }),
        handlers: {
            ...tableBridge.handlers,
            'query.set': applyQueryAndWait,
        },
    };
}
```

页面只把状态与能力交给 context；快照、动作和回执结构留在 `bridged.ts`。

## Guide

`guide.summary` 一句话说清页面功能。它同时生成菜单 `description.md`。

- `summary`：这个菜单能做什么。
- `steps`：页面特有的操作顺序、前置条件、跨表关系。
- `terms`：用户业务词 -> 字段、枚举值或派生列。
- `cautions`：不可逆动作、分组/统计行、查询和筛选的区别、容易误判的空数据。

不要写动作清单，动作已经在 `actions` 里；不要从页面行数据拼 guide，那是不可信内容。

## 表格桥

`createTableBridge` 自动提供：

| 命令 | 语义 |
| --- | --- |
| `<name>.page` | 按显示行号取数，offset 0 等于用户屏幕第一行 |
| `<name>.row` | 按业务主键取完整记录，包含表格未显示字段 |
| `<name>.select` | 按当前显示中的 rowId 选中行 |
| `<name>.filter` | 列上配置 `filterType` 后自动提供 |
| `<name>.filter.clear` | 清空一个或全部筛选 |
| `<name>.filter.options` | enum 列按需取候选值，支持 `match` |

关键配置：

- `columns`：必须与页面共用同一份定义。
- `rowKey`：业务主键，不能拿行号代替。
- `readTable`：传 `() => tableRef.current`。
- `keyFields`：默认投影列，只放辨认、状态、数量等常用字段。
- `columnHints`：字段业务含义、枚举值、单位、格式。
- `waitSelected`：页面按钮的 disabled 依赖 React state 时，等选中落地再回执。
- `unreadableReason`：表在未激活标签页/加载中时说明为什么读不到。

一页多表时给每张表不同 `name`。所有表的目录都常驻 `tables[]`，切换标签页只改变 `visible/readable`，不要换成另一份宿主。

列的 `filterType` 同时决定**快照里 `filters` 的写法**（`<name>.filter` 的 `value` 是同一个口径）：
`enum` 逗号分隔多值、`text` 给关键字、`date` / `number` 写「起~止」（`2026-11-01~2026-11-13`，
单值 = 只筛那一天）。这和页面 `RangePicker` 的 `{min, max}` 一一对应 —— 页面对 `filters`
只读写 `{min, max}`，**不要在页面里再压成单值**，否则快照与界面同时对不上。

## Query

`query` 是改完会重新请求后端的条件，命令通常叫 `query.set`。

- 快照里的 `UIField[]` 与 action 参数从同一份描述派生。
- handler 只接受已知字段，对枚举、日期、区间做收敛和兜底。
- 必须等请求真正落地再 resolve；失败也要 resolve，不能让 `ui_act` 永久挂起。
- 后端分页页面要把查询条件重置到第 1 页，并把匹配总数写进回执。

表内 `filterType` 不是 query。前者只隐藏当前数据，后者重新请求。

### 没有独立查询表单的页面：不要造 query

判据很简单 —— **页面上那排条件是不是 `FilterTable` 的筛选面板**（同一份 `filters` state、
整表一次取回、不发请求）。如果是，就**不要发布 `query` / `query.set`**，全部交给列上的 `filterType`。
V0280（预订单管理）一开始造了一份 `query`，结果是同一批条件两条路：枚举列在表桥里有候选值、
在 `query` 里只能当文本（传「义乌」静默 0 行）；`query.set` 还会用 `setFilters(新条件)`
把用户在面板上筛的其它列一起冲掉。

```ts
// ❌ 页面本没有查询表单，却在桥里再造一份「查询条件」
{id: 'WorkPlace', label: '生产产地', type: 'text', value: filter.WorkPlace ?? ''}
//    → 枚举值没有候选、传错就是 0 行；applyFilter 里 setFilters(next) 还会清掉别列的筛选

// ✅ 只留表桥的命令（列上配了 filterType 就自动有）
actions: [...ctx.commands.map(toAction), ...tableBridge.actions()],
tables: [tableBridge.data({active, selection})],
```

写成这样，`data.filter` 自然带上枚举候选值（`data.filter.options`）、日期「起~止」与按项合并；
guide 里也就只需要教一遍「怎么筛」。

只有当页面**真有**一套独立的、会重新请求后端的查询表单（V0121 / V0124 / V0288 这类）时，
才需要 `query`：那套条件与表筛选是两件事，语义只有页面知道。

### 日期与数值区间：一个条件拆成两个参数

页面上的日期控件基本都是区间（`DatePicker.RangePicker`，`FilterModel` 存 `{min, max}`）。
**页面级 query 里不能只给一个日期参数**：一个字符串只能表达「某一天」，用户在界面上筛的
`2026-11-01 ~ 2026-11-13` 经过桥就只剩一天。

反例（V0280 早期就长这样：桥给单值，页面再 `min = max = 值`，两头各错一半）：

```ts
// ❌ 快照与参数只有一项，区间信息在源头就没了
{id: 'YPDate', label: '预排日期', type: 'text', value: filter.YPDate ?? ''}
// ❌ 页面侧再把它压成单日，界面上筛的一段全部丢失
next.YPDate = {min: filter.YPDate, max: filter.YPDate};
```

正例（V0121 / V0124 / V0126 一类：查询表单里就是一段日期）：

```ts
// 起止各一个字段，type 用 date
{id: 'startDate', label: '开始日期', type: 'date', value: query.startDate,
 hint: '格式 YYYY-MM-DD，含当天；留空传空串 = 不限下限'},
{id: 'endDate', label: '结束日期', type: 'date', value: query.endDate,
 hint: '格式 YYYY-MM-DD，含当天；留空传空串 = 不限上限'},

// 页面侧：两端一起回写表单，否则查询条还停在旧值（见下「回写控件」）
form.setFieldsValue({dateRange: [toDayjs(next.startDate), toDayjs(next.endDate)]});
```

- 命名：查询表单本身就是一段日期的用 `startDate` / `endDate`；**列筛选也是页面 query** 的页面，
  字段名跟着列名走（`YPDate` → `YPDateFrom` / `YPDateTo`）。同一列不要同时留单值参数当兼容，
  真要做就按「起止同一天」解释。
- **`hint` 必须写**：格式、是否含当天、怎么清空。不写时 `params` 只剩字段标签，模型看不出这是区间的一端。
- 快照与页面 state **两端都取**（`min` 与 `max` 都要回填），否则界面上已经是
  `2026-11-01~2026-11-13`，快照却只报一头。
- `query.set` 通常是**按项合并**（只改传入的项）：所以要么在 label / guide 里写清「只改传入项，
  清空传空串」，要么改成整份替换 —— 不说清就会出现「只传了起、旧止还在」的静默收窄。
- 起 > 止时直接回一句人话回绝（V0121 `validateQuery` / V0288「结束不能早于开始」都是这个做法），
  别让它静默筛出 0 行。

### 回写控件：`applyQuery` 不能只 `setQuery`

桥改的是页面 state，`Form` 的 store 不知道。只 `setQuery` 的后果：列表按新条件刷新了，
查询条还显示旧值；用户随后点一次「查询」，就按旧值把 agent 刚改的条件覆盖回去。

```ts
// ✅ 与 setQuery 同一处回写（V0121 / V0122 / V0123 / V0288 都这么做）
form.setFieldsValue({startDate: toDayjs(next.startDate), endDate: toDayjs(next.endDate), orderCode: next.orderCode});
```

比回写更彻底的是**把控件直接受控在 state 上**（V0297 的年份/图表：`value={query.year}`），
它的注释专程写过这个坑 —— 两种都行，但**不能两样都不做**。

## 业务命令

从页面的 `CommandItem` 映射，不复制按钮逻辑：

```ts
actions: ctx.commands.map((item) => ({
    id: item.key,
    label: item.label,
    group: 'toolbar',
    danger: item.danger,
    waitConfirm: item.waitConfirm,
    disabled: item.disabled,
    disabledReason: item.disabled ? '需要先选中一行：用 data.select 传 rowId' : undefined,
}))
```

handler 执行时重新从 `read()` 取最新 command，不要使用创建桥时闭包里的旧 disabled/onClick。

## Ready

- 单表/列表页通常不声明 `ready`，挂载即用；数据行按需取。
- 只有快照结构依赖异步数据时才声明，例如编辑弹窗必须先把单据拉回来，字段表才是真的。
- `ready` 返回 false 会让 `ui_navigate` 轮询，最长 5 秒。不要把首屏列表请求塞进去。

## 页面注册

```tsx
const bridgeContext = useMemo<XxxBridgeContext>(
    () => ({view, query, applyQuery, readTable: () => tableRef.current}),
    [view, query, applyQuery],
);
const bridge = useMemo(() => createXxxBridge(() => bridgeContext), [bridgeContext]);
useUIBridgeHost(view, bridge);
```

不要手拼 View；页面 props 的 `view` 就是菜单 View。
