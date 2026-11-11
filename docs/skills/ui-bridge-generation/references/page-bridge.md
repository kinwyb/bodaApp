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

## Query

`query` 是改完会重新请求后端的条件，命令通常叫 `query.set`。

- 快照里的 `UIField[]` 与 action 参数从同一份描述派生。
- handler 只接受已知字段，对枚举、日期、区间做收敛和兜底。
- 必须等请求真正落地再 resolve；失败也要 resolve，不能让 `ui_act` 永久挂起。
- 后端分页页面要把查询条件重置到第 1 页，并把匹配总数写进回执。

表内 `filterType` 不是 query。前者只隐藏当前数据，后者重新请求。

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
