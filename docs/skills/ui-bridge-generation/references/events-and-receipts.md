# 命令、事件与回执

## Action 设计

`UIAction` 是模型唯一允许执行的入口：

- `id`：稳定且与 handler 完全一致。
- `label`：用户能看懂的动作名。
- `group`：`toolbar | filter | form | row`。
- `danger`：不可逆或高影响动作。
- `disabled/disabledReason`：禁用时写清“为什么 + 下一步该怎么做”。
- `waitConfirm`：点击后只弹确认框、尚未生效的动作必须标。
- `params`：每个参数的 name/type/required/hint 要能让模型一次填对。
- `returns`：正常省略；纯读命令可显式 `result` 省掉等待和 diff。

模型能做的事必须出现在 actions 中。只在快照里给 selection/filter/query 的当前值，不提供修改命令，模型就无法操作它们。

## WaitConfirm

删除、发布、复制等“先弹确认框”的命令：

1. action 标 `waitConfirm: true`；
2. handler 只触发界面动作；
3. 回执明确“已触发、尚未生效，等用户确认”；
4. 用户最终确认/取消/失败通过 `action.outcome` 立即事件上报；
5. 不要重复执行，也不要假装动作已经完成。

## 页面事件

事件只用于真实用户交互主动通知 agent，不是可执行命令：

```ts
events: [{
    id: 'selection.change',
    label: '选中变化',
    mergeBy: ['table'],
    payload: [{name: 'table', type: 'text', required: true}, {name: 'rowId', type: 'text'}],
}]
```

在真实点击/选择回调里调用 `emitActiveUIEvent(...)`。不要在渲染、`ui_act` handler 或快照生成时上报。

普通事件使用 `delivery: 'batch'` 默认值，按 `mergeBy` 合并；确认框终态使用：

```ts
{
    id: 'action.outcome',
    delivery: 'immediate',
    waitConfirmFor: ['delete', 'publish'],
    payload: [
        {name: 'actionId', type: 'text', required: true},
        {name: 'outcome', type: 'text', required: true},
    ],
}
```

`delivery: 'immediate'` 必须配 `waitConfirmFor`，否则公共桥拒绝发送。

## Rev 与回执档位

页面不要自己决定 full/patch/result。

- `result`：纯读，不改状态。
- `patch`：结构不变，只变了取值、行数、选中、筛选、字段值、错误。
- `full`：结构变了，例如打开/关闭弹窗、换模式、列目录或 action 表变化。

旧 rev 的规则：

- 纯读直接放行；
- 幂等写（`form.set*`、`query.set`、`<table>.filter*`、`<table>.select`）在结构与写目标未变时放行；
- submit/delete/新增等不可重放命令必须重新 observe；
- 页面自定义的幂等命令命名要遵守公共桥的识别规则，否则会被误判。

## 查询与筛选

| | 页面 `query` | 表格 `filters` |
| --- | --- | --- |
| 作用 | 重新请求后端数据 | 纯前端隐藏当前行 |
| 命令 | 通常 `query.set` | `<表名>.filter` |
| 来源 | 页面查询表单 | 列上的 `filterType` |
| 回执 | 等请求落地 | 由表格桥同步 |

两者都会影响 `total`。guide 要提醒模型同时检查。

## 错误与回执文案

错误是给模型执行下一步看的信息，不是日志：

- 缺参数：告诉它从哪里取，例如 `rowId` 来自 `data.page`。
- 行不存在：说明可能被筛选、收起或主键错，并给出下一步。
- 字段锁住：说明哪个字段能解锁，或请用户手动设置。
- 保存失败：保留后端原话和具体行/字段/格子的校验原因。
- 不可重放动作被旧 rev 拒绝：明确要求重新 `ui_observe`。

不要只回“失败”“不可用”“操作错误”。
