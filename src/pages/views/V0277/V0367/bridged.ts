/**
 * V0277_V0367（工艺路线矩阵）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身。
 *
 * 这一页是「一页两表」：上方主表 `list`（工艺路线矩阵列表）常驻，选中哪一行决定下方
 * 工序明细看哪个矩阵。下方内置的只有工序明细一张表（`items`）；「发布情况」是页面
 * 通过 `tabs` 追加的只读页签，实例在页面自己手上 —— 与包装 BOM 的第四个页签同一处理，
 * **不进桥**（要读它就先切过去，由用户或 agent 用界面上的表格看）。
 *
 * 编辑弹窗（新增 / 编辑 / 复制）**有自己的一层桥**：`./models/processRouteMatrixEditBridge.ts`
 * 用 `useUIBridgeDialog` 注册，打开期间顶掉本页的这些动作，关闭后让位。
 * 所以这里描述的是「弹窗没开时的本页」，弹窗里的字段与 `items.*` 命令不在这个文件里。
 *
 * 写法约束（与 V0354 / V0189 的 bridged.ts 一致）：只放常量与纯函数，
 * 不导出组件、不调 hook；页面把「怎么取当前状态」以取值函数传进来。
 */

import type {FilterTableApi} from '@/components/grid-table';
import type {CommandItem} from '@/components/CommandBar';
import type {TableReadApi, UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIAction, UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import type {processRouteMatrixListReq} from '@/api/modules/nc/processRouteMatrix.ts';
import {PROCESS_ITEM_COLUMNS} from '@/components/nc/processRouteMatrix/columns.ts';
import {
    isProcessRouteSection,
    PROCESS_ROUTE_SECTIONS,
    type ProcessRouteSection,
    processRouteSectionLabel,
} from '@/components/nc/processRouteMatrix/sections.ts';
import {toStringOrEmpty} from '@/utils';
import {PROCESS_MATRIX_LIST_COLUMNS} from './columns';

/**
 * 本页自述：告诉 agent 这一页该怎么操作。
 *
 * 三条禁忌同协议：不写命令清单（命令已经在 actions 里）、不从页面数据生成、不替控件转述。
 * 这里的重点有两处**界面约束**：主表与工序明细的从属关系、编辑弹窗打开后会换掉整个视野。
 */
const PROCESS_ROUTE_GUIDE: UIGuide = {
    summary: '工艺路线矩阵：上方是矩阵列表，选中一行后用下方「工序明细」看这个物料的工序路线，另有一页「发布情况」看推送状态',
    steps: [
        '主表 list 是工艺路线矩阵列表：用 list.page 按显示行号取行（offset 0 = 屏幕第 1 行），' +
        '选中某一行用 list.select 传它的 rowId（就是 ProcessRouteMatrixID）',
        '**选中主表某一行之后，下方工序明细才是这个矩阵的**：在此之前它装的是上一个矩阵的数据',
        '主表是服务端分页：list.page 与 list.select 只认当前页显示的行；' +
        '看下一页用 list.goto 传 page（从 1 起），换页后行号会变，要重新 list.page 取 rowId',
        '要按物料号找矩阵用 query.set（会重新查库、回到第 1 页）；只想在当前页里临时收窄用 list.filter（不查库）',
        '取工序明细用 items.page（行号从 0 起，与屏幕一致）；它永远在 items 这张表里，不随页签变',
        '「发布情况」页签不进桥：要读它请在界面上切过去，或让用户看 —— 那一页的发布 / 取消发布 / 更新' +
        '会推送到下游 NC，必须由用户确认',
        '要改工艺路线用命令条上的「编辑」：**打开的是表单弹窗，它有自己的界面桥** —— ' +
        '弹窗一开，本页的动作与数据就让位（视野换成弹窗的字段与 items.get / update / add / remove），' +
        '在弹窗里改完用 form.submit 保存（真的入库），关掉弹窗才回到本页',
    ],
    terms: {
        主表: 'list，工艺路线矩阵列表：一行一个物料的一份矩阵，选中哪一行决定下方明细看哪个矩阵',
        工序明细: 'items，工艺矩阵的明细行，一行一道工序（行标识 ProcessRouteMatrixDetailID）',
        行号: 'VRowNo，工序的排序键，按 10 / 20 / 30 递增，插行取中间值',
        转移方式: 'ProcessMoveType，1=不转移 2=自动转移 3=手动转移',
        发布情况: 'pushRules 页签，一行一条规则（特征码 + 工艺版本 + 是否发布）',
        矩阵: 'ProcessRouteMatrixID 指向的那份工艺路线矩阵（主表的一行 = 一份矩阵）',
    },
    cautions: [
        '主表 list 段的 total 是**这一页屏幕上的行数**（服务端分页，只有当前页那几十行），不是匹配总数：' +
        '匹配总数看 query.set / list.goto 的回执，别拿 total 回答「一共几份矩阵」',
        '顶部命令条里「刷新」是完整动作（重查列表）；「发布」只打开「工艺路线矩阵明细」弹窗，' +
        '真正的发布 / 取消发布 / 更新要在弹窗里点，而且会推送到下游 NC —— 这一步要由用户在界面上确认，不要替用户做',
        '新增 / 编辑 / 复制打开的是表单弹窗，**保存走弹窗里的 form.submit（真的入库）**；' +
            '删除会弹确认框，那一下必须由用户在界面上点 —— 别把「点了删除」当成「已经删掉了」',
        '选完主表行再取明细：详情是异步加载的，选中命令的回执会等它落地；如果回执说没等到，稍后用 items.page 再试一次',
        'readable 为 false 的表，total 是 0 但意思是「不知道」——别回答「这一页没有数据」',
        '「发布情况」不在桥里：别用 pushRules.page 去读，那个命令不存在',
    ],
};

/**
 * 一次主表查询的结果。
 *
 * 桥的 `query.set` / `list.goto` 要等请求**真的回来**才回执：不等的话补丁里的行数与页码
 * 还是旧的，模型会以为换页没生效、再来一遍。页面负责在请求落地时把它交出来。
 */
export type ProcessMatrixListResult = {
    /** 请求是否成功。false 时 `rows` / `total` 都不作数 —— 别把它当成「查不到」 */
    ok: boolean;
    /** 实际查的是第几页（从 1 起，页面已经夹过界） */
    page: number;
    /** 这一页落地的行数 */
    rows: number;
    /** 服务端返回的匹配总数 */
    total: number;
};

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type ProcessRouteMatrixBridgeContext = {
    /** 当前 View（菜单里配的那个） */
    view: string;
    /** 矩阵数据：工序明细由它派生 */
    matrix: ProcessRouteMatrix;
    /**
     * 最新矩阵（**ref 版**，不是 state）。
     *
     * 命令 handler 的 `await` 中途需要判断「详情到底落地没有」，那时它手上的 ctx 是命令启动时的闭包，
     * 里面的 `matrix` 恒为旧值。这个函数每次都读 ref，所以能拿到最新值。
     */
    readMatrix: () => ProcessRouteMatrix;
    /** 当前标签页（受控在页面上，控件不自己存） */
    activeKey: string;
    /** 取某张明细表的实例；没渲染过就是 null */
    readTable: (section: string) => TableReadApi | null;
    /** 切标签页：页面负责落 state */
    setActiveKey: (key: string) => void;
    /**
     * 列表接口拉回来没有。
     *
     * 不等就导航，模型会拿到一份「主表还没行」的空快照，随后又得重来一遍。
     */
    isReady: () => boolean;

    // ---- 主表（上方的工艺路线矩阵列表）----
    /** 当前查询条件（页面级 `query` 段就是它） */
    query: processRouteMatrixListReq;
    /** 当前页码（从 1 起）与每页条数：翻页命令要按它夹范围 */
    page: number;
    pageSize: number;
    /** 服务端匹配总数（表格里只有当前页那几十行，总数只有页面知道） */
    totalRows: number;
    /** 取主表的表格实例（`() => tableRef.current`） */
    readListTable: () => FilterTableApi | null;
    /**
     * 按新条件 / 页码重新查库，**等请求落地**再把结果交出来。
     *
     * 页面要把页码与条件一起夹好（越界的页夹到最后一页），并把结果里的 `total` 原样带回来 ——
     * 桥要用它算页数、写回执。
     */
    reloadList: (query: processRouteMatrixListReq, page: number) => Promise<ProcessMatrixListResult>;
    /**
     * 页面顶部命令条（新增 / 编辑 / 复制 / 发布 / 删除 / 刷新）。
     *
     * 动作表**直接由它生成**：命令 ID 就是 `CommandItem.key`，点击执行的就是按钮自己的 `onClick`。
     * 另维护一份清单必然对不上 —— 页面上加个按钮，模型那儿就少一条命令。
     */
    commands: CommandItem[];
};

/** 主表「没渲染时」要说的话 */
const LIST_UNREADABLE = '工艺路线矩阵列表正在加载（首屏接口还没回来）：稍后重试，或重新 ui_observe';

/**
 * 命令条上「要对某一行动手」的按钮（编辑 / 复制 / 发布 / 删除）为什么点不动。
 *
 * 只有一条判据（有没有选中行），所以文案也只写一份。
 */
const NEED_ROW_REASON = '需要先在主表选中一行：用 list.select 传它的 rowId（就是 ProcessRouteMatrixID）';

/** 主表的默认投影列：模型多数时候只看这几列认单，其余用 fields 指名 */
const LIST_KEY_FIELDS = [
    'MaterialCode',
    'MaterialName',
    'ProjectCode',
    'PackMethod',
    'PackNum',
    'MatrixVersion',
];

const LIST_COLUMN_HINTS: Record<string, string> = {
    MaterialCode: '物料的编码：主表的「物料」查询条件就是它',
    MaterialName: '物料的名称',
    MatrixVersion: '矩阵版本：同一个物料可能有多份（不同版本各自一份矩阵）',
};

/** 工序明细的常用列：模型多数时候只看这几列，其余用 fields 指名 */
const ITEM_KEY_FIELDS = [
    'VRowNo',
    'CrcCode',
    'CrcName',
    'WorkStation',
    'MainProcess',
    'WorkTime',
    'ProcessMoveType',
];

const ITEM_COLUMN_HINTS: Record<string, string> = {
    VRowNo: '行号：工序的排序键，按 10 递增，插行取中间值',
    CrcCode: '工序编码',
    CrcName: '工序名称',
    WorkStation: '工作中心',
    MainProcess: '主工序（勾选）',
    ProcessMoveType: '转移方式：1=不转移 2=自动转移 3=手动转移',
    MixDeliverNum: '浮余系数，默认 1',
    VDef9: '标准时间（小时）',
    WorkTime: '工作时间（小时）',
    VDef11: '工序工价',
    VDef12: '小时工资',
    VDef13: '小时产量',
    VDef5: '审核状态：0=未审核 1=已审核（后端流程，界面只读）',
    VDef6: '审核人',
    VDef7: '审核时间',
};

/** 工序明细「没渲染时」要说的话 */
function unreadableReason(ctx: ProcessRouteMatrixBridgeContext): string {
    const title = processRouteSectionLabel('items');
    return ctx.activeKey === 'items'
        ? `「${title}」正在渲染，稍后重试，或重新 ui_observe`
        : `「${title}」此刻没打开：先用 tab.switch 把 key 设为 items（切过去数据才会渲染）`;
}

/** 等一帧（表格把新 records 消化成显示行要一两帧） */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 16));
}

/** 等工序明细表真的能读：面板懒挂载，切过去之后才渲染 */
async function waitForTable(
    read: () => ProcessRouteMatrixBridgeContext,
    section: ProcessRouteSection,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // 明细本身是空的，就不用再等「行数变成非 0」了
    const hasSourceRows = (read().matrix.Detail ?? []).length > 0;
    while (Date.now() < deadline) {
        const table = read().readTable(section);
        if (table) {
            if (!hasSourceRows) return true;
            /*
             * 实例有了还不够：视图的 records 是 effect 里灌进去的，表格把 records
             * 消化成显示行还要再等一两帧。等到真有行再回执 —— 否则回执里的 total 是 0，
             * 模型会以为这一页没有数据。
             */
            if (table.getDisplayInfo().rowCount > 0) return true;
        }
        await nextFrame();
    }
    return read().readTable(section) !== null;
}

/**
 * 等主表选中某一行之后，**矩阵详情与工序明细都换成那一份**。
 *
 * 这一步不能省：`list.select` 之后详情是异步拉的，不给时间就回执，紧接着的 `items.page`
 * 拿到的还是上一个矩阵的行 —— 模型会把两份矩阵串在一起回答。
 *
 * 判定用 `readMatrix()`（ref）而不是 ctx 里的 `matrix`：ctx 是命令启动时的闭包。
 */
async function waitForMatrixDetail(
    read: () => ProcessRouteMatrixBridgeContext,
    matrixID: string,
    timeoutMs = 1600,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ctx = read();
        const matrix = ctx.readMatrix();
        if (matrix.ProcessRouteMatrixID === matrixID) {
            const table = ctx.readTable('items');
            const expected = (matrix.Detail ?? []).length;
            // 当前不是工序明细页时，只需要详情对上（那一页此刻没渲染）
            if (ctx.activeKey !== 'items') return true;
            if (table && table.getDisplayInfo().rowCount === expected) return true;
        }
        await nextFrame();
    }
    return false;
}

/** 等主表把新一页的数据渲染进表格（换页 / 换条件后 records 是 effect 里灌的） */
async function waitForListRows(
    read: () => ProcessRouteMatrixBridgeContext,
    expected: number,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const table = read().readListTable();
        if (table && table.getDisplayInfo().rowCount === expected) return true;
        await nextFrame();
    }
    return false;
}

/**
 * 页面级查询条件（顶部表单）。
 *
 * 与表上的 `list.filter` 分工：那是列头筛选面板（纯前端隐掉几行，桥自动读写），
 * 这里改完会**重新查库**。
 */
function currentQuery(query: processRouteMatrixListReq): UIField[] {
    return [
        {
            id: 'MaterialCode',
            label: '物料（编码）',
            type: 'text',
            value: query.MaterialCode ?? '',
            hint: '按物料编码模糊查；留空 = 不限。改完会重新查库并回到第 1 页',
        },
        {
            id: 'ProjectCode',
            label: '项目',
            type: 'text',
            value: query.ProjectCode ?? '',
            hint: '按项目编码模糊查；留空 = 不限',
        },
    ];
}

/**
 * 装配本页的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象：快照与命令都在「被调用的那一刻」才读页面状态。
 */
export function createProcessRouteMatrixBridge(
    read: () => ProcessRouteMatrixBridgeContext,
): UIBridgeHost {
    const {pageSize, commands} = read();

    /** 主表：上方的工艺路线矩阵列表。选哪一行，决定下方工序明细看哪个矩阵 */
    const list = createTableBridge({
        name: 'list',
        columns: PROCESS_MATRIX_LIST_COLUMNS,
        rowKey: 'ProcessRouteMatrixID',
        readTable: () => read().readListTable(),
        unreadableReason: () => LIST_UNREADABLE,
        keyFields: LIST_KEY_FIELDS,
        columnHints: LIST_COLUMN_HINTS,
        // 选中 = 让下方换成这个矩阵的明细：不等详情落地就回执，接下来的 items.page 会取到上一份矩阵
        waitSelected: (rowId) => waitForMatrixDetail(read, rowId),
    });

    /** 工序明细：唯一内置的明细表 */
    const items = createTableBridge({
        name: 'items',
        columns: PROCESS_ITEM_COLUMNS,
        rowKey: 'ProcessRouteMatrixDetailID',
        readTable: () => read().readTable('items'),
        unreadableReason: () => unreadableReason(read()),
        keyFields: ITEM_KEY_FIELDS,
        columnHints: ITEM_COLUMN_HINTS,
    });

    /** 动作表：命令条 + 主表 + 查询 + 翻页 + 切页签 + 工序明细 */
    const actions = (): UIAction[] => [
        /*
         * 页面顶部那排按钮（新增 / 编辑 / 复制 / 发布 / 删除 / 刷新）。
         *
         * 直接由页面的 commands 生成，命令 ID 就是按钮 key —— 不在这里另写一份。
         * `disabled` 不进结构指纹（见 ui-bridge/handler.ts 的 structureKey），
         * 所以「选中行变化 → 按钮变灰」只走补丁，不会整页重发。
         */
        ...read().commands.map((item) => ({
            id: item.key,
            label: item.label,
            group: 'toolbar' as const,
            danger: item.danger,
            waitConfirm: item.waitConfirm,
            disabled: item.disabled,
            disabledReason: item.disabled ? NEED_ROW_REASON : undefined,
        })),
        ...list.actions(),
        {
            /*
             * 查询条件改的是「查哪批数据」：要发请求，语义只有页面知道，所以命令由页面提供。
             * 表上的筛选（list.filter）相反 —— 列上配了 filterType 就由表格桥全自动接管。
             */
            id: 'query.set',
            label: '设置查询条件并重新查询',
            group: 'filter',
            params: [
                {
                    name: 'MaterialCode',
                    type: 'text',
                    hint: '物料编码（模糊匹配）；传空串 = 不再按物料过滤',
                },
                {
                    name: 'ProjectCode',
                    type: 'text',
                    hint: '项目编码（模糊匹配）；传空串 = 不再按项目过滤',
                },
            ],
        },
        {
            /*
             * 服务端分页：`list.page` 只能按行号取当前这一页的行，翻页必须显式给入口，
             * 否则模型会以为「第 31 条」取不到是数据没了。
             */
            id: 'list.goto',
            label: '主表翻页',
            group: 'toolbar',
            params: [
                {
                    name: 'page',
                    type: 'number',
                    required: true,
                    hint: `第几页（从 1 起）。主表是服务端分页，每页 ${pageSize} 条；超出范围会停到最后一页`,
                },
            ],
        },
        {
            /*
             * 切页签必须是一条显式命令：没切过去的表 readable:false，
             * 模型不切就永远读不到，「用 xxx 切过去」这句话需要一个能执行的东西。
             */
            id: 'tab.switch',
            label: '切换页签',
            group: 'toolbar',
            params: [
                {
                    name: 'key',
                    type: 'select',
                    required: true,
                    options: PROCESS_ROUTE_SECTIONS.map((item) => item.key),
                    hint: `要切到哪一页：${PROCESS_ROUTE_SECTIONS.map((item) => `${item.key}=${item.label}`).join('、')}` +
                        '（pushRules 是页面追加的只读页，切过去之后桥里没有它的取数命令）',
                },
            ],
        },
        ...items.actions(),
    ];

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        return {
            view: ctx.view,
            title: '工艺路线矩阵',
            mode: 'list',
            guide: PROCESS_ROUTE_GUIDE,
            actions: actions(),
            query: currentQuery(ctx.query),
            /*
             * 两张表都在 `tables` 里（没有「主表」这个特权位置），定位只认各自的 name。
             * 工序明细的 `visible` 跟着页签走 —— 切到「发布情况」之后它就是 false。
             */
            tables: [
                list.data(),
                items.data({visible: ctx.activeKey === 'items'}),
            ],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {
        ...list.handlers,
        ...items.handlers,

        /*
         * 改查询条件 → 重新查库 → 等列表真的换了再回执。
         *
         * 只认已知字段：页面 state 是业务对象，脏值进去只会让它带着脏值发请求。
         * 传空串是「去掉这个条件」，与筛选面板删掉一个条件同义。
         */
        'query.set': async (params) => {
            const ctx = read();
            const next: processRouteMatrixListReq = {...ctx.query};
            /*
             * 「没传这个参数」= 不动它，「传空串」= 去掉这个条件 —— 两者必须分开：
             * 只按空串处理的话，模型少写一个字段就会把用户刚设的条件悄悄清掉。
             */
            (['MaterialCode', 'ProjectCode'] as const).forEach((field) => {
                if (params[field] === undefined) return;
                const value = toStringOrEmpty(params[field]).trim();
                if (value) next[field] = value;
                else delete next[field];
            });

            // 换了条件一定回第 1 页：留在第 5 页看新条件的结果，多半是空的
            const result = await ctx.reloadList(next, 1);
            const scope = [
                next.MaterialCode ? `物料「${next.MaterialCode}」` : '',
                next.ProjectCode ? `项目「${next.ProjectCode}」` : '',
            ].filter((text) => text !== '').join('、') || '全部物料';
            if (!result.ok) {
                return `已按${scope}发起查询，但请求失败了（列表还是原来的样子）：先确认网络 / 后端，再重试一次`;
            }
            const landed = await waitForListRows(read, result.rows);
            if (!landed) {
                return `已按${scope}重新查询，但列表还没渲染出来：稍后用 list.page 取行`;
            }
            if (result.total === 0) return `已按${scope}重新查询：没有匹配的工艺路线矩阵`;
            return (
                `已按${scope}重新查询：共 ${result.total} 条，第 1 页 ${result.rows} 行。` +
                `用 list.page 取行，list.select 选中（下方明细会自动切到新的第一行，选中别的行就跟着换）`
            );
        },

        /*
         * 翻页：夹到 [1, 最后一页]。
         *
         * 页码越界不当错误处理：模型多半是照「共 45 条、每页 30」自己算的页数，
         * 差一页很常见，直接停到最后一页并如实说明，比抛错让它重算更有用。
         */
        'list.goto': async (params) => {
            const ctx = read();
            const wanted = Math.floor(Number(params.page));
            if (!Number.isFinite(wanted) || wanted < 1) {
                throw new Error('list.goto 的 page 要从 1 起（第 1 页传 1，不是 0）');
            }
            const size = Math.max(1, ctx.pageSize);
            /*
             * 上界只在知道总数时才夹：首屏数据还没回来时 `totalRows` 是 0，
             * 按它算出来「最多 1 页」，会把要第 2 页的请求硬拽回第 1 页 —— 模型看到的是「翻页没反应」。
             */
            const maxPage = ctx.totalRows > 0 ? Math.max(1, Math.ceil(ctx.totalRows / size)) : Infinity;
            const page = Math.min(wanted, maxPage);
            if (page === ctx.page) {
                const table = ctx.readListTable();
                const rows = table?.getDisplayInfo().rowCount ?? 0;
                return `已经在第 ${page} 页（每页 ${size} 条，共 ${ctx.totalRows} 条，本页 ${rows} 行）`;
            }
            const result = await ctx.reloadList(ctx.query, page);
            if (!result.ok) {
                return `翻页请求失败了（还停在第 ${ctx.page} 页，共 ${ctx.totalRows} 条）：先确认网络 / 后端，再重试一次`;
            }
            const landed = await waitForListRows(read, result.rows);
            const where = `第 ${result.page}/${Math.max(1, Math.ceil(result.total / size))} 页`;
            if (!landed) {
                return `已切到${where}（本次未等到渲染）：稍后用 list.page 取行`;
            }
            if (result.rows === 0) {
                return `${where} 没有行（共 ${result.total} 条）：可能刚好这一页空了，用 list.goto 回上一页`;
            }
            const clamped = page !== wanted ? `（要的是第 ${wanted} 页，已夹到最后一页）` : '';
            return (
                `${where}，本页 ${result.rows} 行，共 ${result.total} 条${clamped}：用 list.page 取行` +
                `（下方明细会自动切到本页第一行，选中别的行用 list.select）`
            );
        },

        'tab.switch': async (params) => {
            const key = params.key;
            if (!isProcessRouteSection(key)) {
                throw new Error(
                    `未知的页签：${String(key)}。可选 ${PROCESS_ROUTE_SECTIONS.map((item) => item.key).join(' / ')}`,
                );
            }
            const ctx = read();
            if (ctx.activeKey === key) {
                const table = ctx.readTable(key);
                const total = table?.getDisplayInfo().rowCount ?? 0;
                return `已经在「${processRouteSectionLabel(key)}」这一页（${total} 行）`;
            }
            ctx.setActiveKey(key);
            const landed = await waitForTable(read, key);
            const table = read().readTable(key);
            const total = table?.getDisplayInfo().rowCount ?? 0;
            if (!landed) {
                return `已切到「${processRouteSectionLabel(key)}」，但表格还没渲染出来：稍后用 ${key}.page 读一次`;
            }
            if (key === 'pushRules') {
                /*
                 * 发布情况是页面追加的只读页签，没进桥：如实说「这一页没有取数命令」，
                 * 别让模型以为 ${key}.page 只是暂时读不到。
                 */
                return `已切到「${processRouteSectionLabel(key)}」（${total} 行）。这一页是只读的、没接入取数命令：` +
                    '内容请以界面为准，发布 / 取消发布 / 更新要由用户操作';
            }
            if (total === 0) {
                return `已切到「${processRouteSectionLabel(key)}」，表格当前 0 行（可能还在渲染，也可能这一页没有数据）：` +
                    `用 ${key}.page 读一次确认`;
            }
            return `已切到「${processRouteSectionLabel(key)}」（${total} 行），用 ${key}.page 取行`;
        },
    };

    /*
     * 命令条上的每条按钮**直接用它自己的 onClick**，不另写一份实现 —— 抄一份的代价是行为分叉。
     * 这里只包一层，顺便回一句人话给模型当回执（否则 result 是 null，模型只能猜按钮按下去没有）。
     *
     * 按 key 重新取最新那份命令：`disabled` 依赖选中行，建桥时闭包里那份可能已经过期。
     */
    commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            const latest = read().commands.find((cmd) => cmd.key === item.key) ?? item;
            if (latest.disabled) return `「${latest.label}」现在不可用：${NEED_ROW_REASON}`;
            latest.onClick?.();
            /*
             * 要用户在界面上确认的命令：回执**不能**说「已执行」。
             *
             * 点下去真正发生的只是「弹出一个确认框」，接口还没调、数据一个字都没动；
             * 而 agent 没有「点确认」这个动作，它要么等用户点，要么永远等不到。
             */
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但**还没有生效**：界面上弹出了确认框，用户点「确认」之后才会执行。` +
                    '不要重复调用这条命令（会再弹一个框）；确认结果以稍后重新 ui_observe / 读表格为准';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot,
        handlers,
        ready: () => read().isReady(),
        events: [
            {
                id: 'selection.change',
                label: '工艺路线矩阵主表选中变化',
                mergeBy: ['table'],
                payload: [{name: 'rowId', type: 'text'}],
                hint: '用户选中工艺路线矩阵主表行时上报，连续变化只保留最后一次',
            },
            {
                id: 'tab.change',
                label: '工艺路线矩阵页签切换',
                mergeBy: ['section'],
                payload: [{name: 'section', type: 'text', required: true}],
                hint: '用户切换明细页签时上报，同一页签只保留最后一次',
            },
            {
                id: 'action.outcome',
                label: '需要确认的命令结果',
                delivery: 'immediate',
                waitConfirmFor: ['delete'],
                mergeBy: ['actionId'],
                payload: [
                    {name: 'actionId', type: 'text', required: true},
                    {name: 'outcome', type: 'text', required: true},
                ],
                hint: '只在 agent 发起 delete 后，用户最终确认或取消时立即上报',
            },
        ],
    };
}
