/**
 * V0189_V0279_V0280（计划管理 > 预订单 > 预订单管理）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身 ——
 * 页面功能不受影响，但模型既看不到这一页、也不会把它列进可导航清单。
 *
 * 三条约束：
 * - 只放常量与纯函数：不导出组件、不调 hook。页面把「怎么取当前状态」以取值函数传进来，
 *   工厂只做装配 —— 在工厂里调 hook 会变成「在页面的 hook 回调里调 hook」。
 * - 不重复描述命令：动作表直接来自页面的 `commands`（就是 CommandBar 的按钮），
 *   命令 ID 就是 `CommandItem.key`，另维护一份清单必然对不上。
 * - **表格的读能力全部来自 `createTableBridge`**：列目录、行数、排序、按行号取数据都在
 *   那一层。这里只补业务部分（筛选条件、选中行、命令条）。
 */

import type {YupaiOrder} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {COLUMNS} from './columns';

export interface YupaiOrderFilter {
    WorkPlace?: string,
    OrderCode?: string,
    YPDate?: string,
    Ywy?: string,
}

/**
 * 页面自述：告诉 agent 这一页该怎么操作。
 *
 * 只写快照里推不出来的东西 —— 操作顺序、前置条件、业务术语、陷阱。
 * 两条禁忌：不写命令清单（命令已经在 actions 里，再写一份就是对不上的平行维护）；
 * 不从页面数据生成（这里是可信内容，data 才是不可信内容）。
 */
const PREORDER_GUIDE: UIGuide = {
    summary: '预订单管理：按条件查询预订单，并对选中的单据执行编辑、发布、分批、查看变更日志等操作',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行（「第 5 条」就传 offset=4）',
        'data.page 默认只回关键列（结果里的 fields 会写明给了哪些）：要别的列就传 fields，要全部列传 fields="*"',
        '要看表格上没显示的字段（主键、分批明细、状态位等）或核对整单：用 data.row 传 rowId 取完整一行',
        '改条件用 filter.set（参数名见该 action 的 params），等列表变成你要的范围再动单据',
        '删除 / 发布 / 分批 / 复制 / 设置 要求先选中行：用 data.select 传 rowIds（取 data.page 或 data.active 里的 rowId）',
        '新增 / 编辑 会打开表单弹窗，弹出后快照会切成表单那一层（见它自己的 guide）',
    ],
    terms: {
        生产产地: 'WorkPlace，只可选「越南工厂,义乌工厂」',
        rowId: '单据的业务主键（字段名见 data.rowKey，一般是 ID；不用行号：排序一变行号就全错）',
        第几条: '用户说的「第 N 条」= data.page 的 offset N-1，与屏幕行号一致（排序后）',
    },
    cautions: [
        '命令被禁用时先看 disabledReason，不要反复重试',
        'data.select 只认当前显示里的行：目标被筛掉了就先用 filter.set 放宽条件',
        'data.total 是屏幕行数：含分组时的组行（isGroupRow）与底部统计行（summaryRow），回答「共几条」时只数明细行',
        '行号只在当前排序 / 筛选下成立：改条件或用户重新排序后要重新取，别拿旧行号做删除等操作',
    ],
};

/** 把 agent 传来的筛选参数收敛成查询条件：只认已知字段，避免脏值进 state */
function toQueryPatch(params: Record<string, unknown>): YupaiOrderFilter {
    const patch: YupaiOrderFilter = {};
    if (typeof params.Ywy === 'string') patch.Ywy = params.Ywy;
    if (typeof params.OrderCode === 'string') patch.OrderCode = params.OrderCode;
    if (typeof params.WorkPlace === 'string') patch.WorkPlace = params.WorkPlace;
    if (typeof params.YPDate === 'string') patch.YPDate = params.YPDate;
    return patch;
}

/**
 * 等页面把选中态落回 state。
 *
 * `selectRows` 只把选中写进表格实例，页面的 `activeRow` 是表格回调驱动的 React state，
 * 要到下一次渲染才更新。命令 handler 在这中间 `await`，而它手里的 ctx 是**启动时**的闭包，
 * 直接读 `ctx.activeRow` 永远是旧值 —— 所以这里走 `readActiveRow()`（页面用 ref 实现）。
 *
 * 轮询而不是「等一帧」：并发渲染可能推迟几帧。
 */
async function waitForActiveRow(
    readActiveRow: () => YupaiOrder | null,
    rowId: string,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (toStringOrEmpty(readActiveRow()?.ID) === rowId) return true;
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return false;
}

/**
 * 快照里的筛选条件：同一份数据既当「当前值」发布，也当 filter.set 的参数声明 ——
 * 一处维护，不会出现「filters 里有产地、命令里却没有」这种对不上的情况。
 */
function currentFilters(filter: YupaiOrderFilter): UIField[] {
    return [
        {id: 'OrderCode', label: '订单号', type: 'text', value: filter.OrderCode ?? ''},
        {id: 'Ywy', label: '业务员', type: 'text', value: filter.Ywy ?? ''},
        {id: 'WorkPlace', label: '生产产地', type: 'text', value: filter.WorkPlace ?? ''},
        {id: 'YPDate', label: '预排日期', type: 'text', value: filter.YPDate ?? ''},
    ];
}

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type YupaiOrderBridgeContext = {
    /** 当前 View（可能带子级，菜单里配的就是它） */
    view: string;
    /** 命令条上的命令项：动作表与页面按钮同源 */
    commands: CommandItem[];
    /** 当前激活行（命令 disabled 与快照 selection 段都读它） */
    activeRow: YupaiOrder | null;
    /** 选中行数（只驱动 disabled，行数据向表格要） */
    activeRowCount: number;
    /**
     * 预订单过滤
     */
    filter: YupaiOrderFilter;
    /** 列表是否已加载完成；ui_navigate 打开本页后会等它 */
    ready: boolean;
    /** 用新条件重新查询：页面负责落 state 并拉数据 */
    applyFilter: (next: YupaiOrderFilter) => Promise<void>;
    /**
     * 取表格实例（`() => tableRef.current`）。
     *
     * 「用户看到的第几行是什么」只有表格知道 —— 排序、分组、统计行都发生在表格里，
     * 页面 state 里没有这些信息。桥靠它按显示行号取数据、选中行、读行数与排序。
     */
    readTable: () => FilterTableApi | null;
    /**
     * 读「当前激活行」的最新值（页面用 ref 实现，**不是**读 ctx 里的 activeRow）。
     *
     * 命令 handler 在 `await` 中途需要知道「选中到底落地没有」，那时它手上的 ctx 是启动时的闭包，
     * 里面的 `activeRow` 恒为旧值。这个函数每次都读 ref，所以能拿到最新值。
     */
    readActiveRow: () => YupaiOrder | null;
};

/**
 * 会把视野换成表单弹窗的命令：执行完要回**整页快照**（`returns: 'full'`）。
 *
 * 判据只有一条 —— 模型是不是第一次见这段结构。这几条之后快照的 actions 会换成弹窗那一套
 * （form.* / detail.*），字段表与参数说明它手里没有，只给补丁它就没有可填的字段清单。
 * 其余命令（改条件、选中、删单、发布、刷新……）都只是取值变，走默认的 patch。
 */
const FORM_DIALOG_COMMANDS = new Set(['add', 'edit', 'copy', 'copyOrdered']);

/**
 * 装配本页的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象本身：桥的 snapshot / handler 都在「被调用的那一刻」
 * 才去读页面状态。宿主对象因此可以长期不变，而读到的永远是最新的 query、选中行与命令表
 * （这与 `registerPageHost` 存 getter 而不是存快照是同一个理由）。
 */
export function createYupaiOrderBridge(read: () => YupaiOrderBridgeContext): UIBridgeHost {
    /*
     * 表格那部分交给通用桥：列目录、行数、排序、data.page 全在它那边。
     * 这里只给「列定义 + 怎么拿表格」—— agent 认识这张表的全部依据就是这份列定义。
     */
    const tableBridge = createTableBridge({
        columns: COLUMNS,
        // 与 FilterTable 的 rowKey 一致：表格不显示主键，但 agent 得知道 rowId 来自哪个字段
        rowKey: 'ID',
        // 每次调用现读：ctx 会随渲染重建，桥持有的必须是最新那个 readTable
        readTable: () => read().readTable(),
        /*
         * 默认投影列：这张表 52 列，一次全给是最贵的一帧。
         * 给的是「认单 + 看状态 + 看数量」那几列（含五个阶段位，进度判断靠它们）；
         * 颜色、克重、工时、MCSize 这类要核对时才取 —— 模型传 fields 或 fields="*"。
         */
        keyFields: [
            'OrderCode',
            'YPDate',
            'WorkPlace',
            'Ywy',
            'Qty',
            'Number',
            'StyleCode',
            'ProduceName',
            'HDWorkName',
            'JHDate',
            'QRDate',
            'ZHDate',
            'XDRate',
            'SSStep',
            'QMStep',
            'WaitCustStep',
            'WaitOrderStep',
            'OtherStep',
            'Memo',
        ],
        columnHints: {
            WorkPlace: '可选值：越南工厂 / 义乌工厂',
            YPDate: '预排日期，格式 YYYY-MM-DD',
        },
        // 页面工具栏的 disabled 读 activeRow（React state），选中后要等它落地再回执
        waitSelected: (rowId) => waitForActiveRow(() => read().readActiveRow(), rowId),
    });

    /*
     * 页面这一层只描述列表。
     *
     * 弹窗打开时的覆盖（动作换成 form.*、列表数据收起、guide 换成表单那份）由桥统一做，
     * 弹窗自己注册 —— 所以这里没有任何 form 相关的分支，页面也不需要认识弹窗的字段。
     */
    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const filters = currentFilters(ctx.filter);
        return {
            view: ctx.view,
            title: '计划管理 > 预订单 > 预订单管理',
            mode: 'list',
            guide: PREORDER_GUIDE,
            actions: [
                ...ctx.commands.map((item) => ({
                    id: item.key,
                    label: item.label,
                    group: 'toolbar' as const,
                    danger: item.danger,
                    disabled: item.disabled,
                    // 只有「模型没见过的新结构」需要整页快照，其余走默认补丁
                    returns: FORM_DIALOG_COMMANDS.has(item.key) ? ('full' as const) : ('patch' as const),
                    // 本页命令的 disabled 几乎都来自「没有选中行」，写清原因省得模型反复试错
                    disabledReason: item.disabled ? '需要先选中一行：用 data.select 传 rowIds' : undefined,
                })),
                // 取数据（data.page）+ 选中行（data.select）：都与业务无关，全在通用表格桥里
                ...tableBridge.actions(),
                {
                    // 改筛选条件本身也是一条命令。只发 filters 不发命令，模型就只能干猜
                    id: 'filter.set',
                    label: '设置筛选条件',
                    group: 'filter' as const,
                    // 改条件只换筛选取值与结果行数：列目录、guide、动作表都没变，回补丁
                    returns: 'patch' as const,
                    params: filters.map((field) => ({
                        name: field.id,
                        type: field.type,
                        hint: field.label,
                    })),
                },
            ],
            filters,
            selection: {
                count: ctx.activeRowCount,
                activeRowId: ctx.activeRow?.ID ?? null,
                rowIds: ctx.activeRow ? [ctx.activeRow.ID] : [],
            },
            /*
             * 数据段 = 目录：列、行数、排序、统计行位置，**没有数据行**。
             * active 用页面这份（表格判定的激活行未必是业务认可的：点到底部统计行时页面算「没选中」）。
             */
            data: tableBridge.data({active: ctx.activeRow}),
        };
    };

    return {
        snapshot,
        handlers: {...buildHandlers(read), ...tableBridge.handlers},
        // 列表加载完成才算就绪。弹窗自己的就绪由弹窗那层报（见 useUIBridgeDialog 的 ready）
        ready: () => read().ready,
    };
}

/**
 * 命令处理表。
 *
 * 命令条上的每个按钮**直接用它自己的 onClick**，不另写一份实现 —— 抄一份的代价是行为分叉：
 * 按钮改了、agent 那条没改，或者反过来。这里只包一层，顺便回一句人话给模型当回执
 * （否则 result 是 null，模型只能猜按钮到底按下去没有）。
 *
 * 数据读取（data.page）不在这里：它来自 `tableBridge.handlers`，与本页业务无关。
 */
function buildHandlers(read: () => YupaiOrderBridgeContext): Record<string, UIBridgeHandler> {
    const handlers: Record<string, UIBridgeHandler> = {};

    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            // 命令项会随选中行重新生成，闭包里存着的那个可能已经过期，执行时按 key 重新取
            const latest = read().commands.find((cmd) => cmd.key === item.key) ?? item;
            latest.onClick?.();
            return `已执行：${latest.label}`;
        };
    });

    /**
     * 语义命令：改查询条件并按新条件重新加载。
     *
     * 这里等查询真的返回再回执：否则补丁里的 `data.total` 还是旧行数，
     * 模型会以为筛选没生效（页面的 useEffect 也会因 query 变化再拉一次，
     * 两个请求内容一致，真实实现应收敛成一条加载路径）。
     */
    handlers['filter.set'] = async (params) => {
        const ctx = read();
        await ctx.applyFilter({...ctx.filter, ...toQueryPatch(params)});
        return `已按 ${JSON.stringify(params)} 重新过滤`;
    };

    return handlers;
}
