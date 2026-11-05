/**
 * V0277_V0354（包装 BOM 矩阵）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身。
 *
 * 这一页是「一页多表」的样本：**主表 + 三个标签页的明细表**。
 *
 * - 主表 `list`（上方的包装 BOM 列表）常驻：选哪一行，决定下方三张表看的是哪个矩阵；
 * - 明细三张表的目录**全部常驻**快照（`tables[]` 的三个元素），列定义与视图共用 `./columns`；
 * - 只有数据按需取（`list.page` / `items.page` / `colors.page` / `sizes.page`）；
 * - 「此刻能不能读」由 `readable` 说、「用户看不看得见」由 `visible` 说 ——
 *   两个都不进结构指纹，所以切标签页只回一条补丁，而不是整页重发。
 *
 * 三条写法约束（与 V0189_V0279_V0280 的 bridged.ts 一致）：只放常量与纯函数，
 * 不导出组件、不调 hook；页面把「怎么取当前状态」以取值函数传进来。
 */

import type {FilterTableApi} from '@/components/grid-table';
import type {CommandItem} from '@/components/CommandBar';
import type {TableReadApi, UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIAction, UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {PackBomMatrix} from '@/api/schemas/nc/bomMatrix.ts';
import type {packBomMatrixListReq} from '@/api/modules/nc/bomMatrix.ts';
import {buildColorColumns, buildSizeColumns, ITEM_COLUMNS} from '@/components/nc/bomMatrix/columns.ts';
import {
    BOM_MATRIX_SECTIONS,
    type BomMatrixSection,
    bomMatrixSectionLabel,
    DEFAULT_BOM_MATRIX_SECTION,
    isBomMatrixSection,
} from '@/components/nc/bomMatrix/sections.ts';
import {toStringOrEmpty} from '@/utils';
import {MATRIX_LIST_COLUMNS} from './columns';

/**
 * 本页自述：告诉 agent 这一页该怎么操作。
 *
 * 三条禁忌同协议：不写命令清单（命令已经在 actions 里）、不从页面数据生成、不替控件转述。
 * 这里的重点有两处**界面约束**：主表与明细的从属关系、标签页同一时刻只渲染一张 ——
 * 不写清楚，模型会拿 `total: 0` 当成「这页没数据」，或者拿上一个矩阵的明细当这个矩阵的。
 */
const BOM_MATRIX_GUIDE: UIGuide = {
    summary: '包装 BOM 矩阵：上方是包装 BOM 列表，选中一行后用下方三张表看它的子项物料、配色与配码',
    steps: [
        '主表 list 是包装 BOM 列表：用 list.page 按显示行号取行（offset 0 = 屏幕第 1 行），' +
        '选中某一行用 list.select 传它的 rowId（就是 PackBomMatrixID）',
        '**选中主表某一行之后，下方三张表才是这个矩阵的明细**：在此之前它们装的是上一个矩阵的数据',
        '主表是服务端分页：list.page 与 list.select 只认当前页显示的行；' +
        '看下一页用 list.goto 传 page（从 1 起），换页后行号会变，要重新 list.page 取 rowId',
        '要按物料号找矩阵用 query.set（会重新查库、回到第 1 页）；只想在当前页里临时收窄用 list.filter（不查库）',
        '三张明细表是**同一批子项行的三种看法**，但界面同一时刻只渲染一个标签页：' +
        '要读哪一张先用 tab.switch 切过去，切过去之后那张表的 total 才是真的',
        '取数各用各的前缀：子项物料 items.page、配色 colors.page、配码 sizes.page（行号从 0 起，与屏幕一致）',
        'tables 里 name=items 的那张永远是「子项物料」；切到配色/配码后它的 visible 会变成 false —— ' +
        '用户说的「这一行」指的是 visible 为 true 的那张表',
        'colors / sizes 的行与 items 一一对应（同一个子项物料一行）：三张表的 rowId 都是明细主键，' +
        '跨表对行直接用 rowId；行号（VRowNo）是业务排序键，改了行号 rowId 不变',
    ],
    terms: {
        主表: 'list，包装 BOM 列表：一行一个包装物料，选中哪一行决定下方明细看哪个矩阵',
        子项物料: 'items，包装 BOM 的明细行，一行一个物料（唯一在界面上可编辑的一张）',
        配色: 'colors，每列一个缝制颜色，格子里是该颜色下这个物料的色号',
        配码: 'sizes，每个尺码三列：损耗数量 / 尺码系数 / 尺码用量',
        标签页: '三个 tab，key 分别是 items / colors / sizes',
        损耗系数: 'Ndissipationum，小数形式（0.03 = 3%）',
        矩阵: 'PackBomMatrixID 指向的那份包装 BOM（主表的一行 = 一份矩阵）',
    },
    cautions: [
        '主表 list 段的 total 是**这一页屏幕上的行数**（服务端分页，只有当前页那几十行），不是匹配总数：' +
        '匹配总数看 query.set / list.goto 的回执，别拿 total 回答「一共几份矩阵」',
        '顶部命令条里「刷新」「发布」是完整动作：刷新重查列表；发布**只打开「包装BOM矩阵明细」弹窗**，' +
            '真正的发布 / 取消发布 / 更新要在弹窗里点，而且会推送到下游 NC —— 这一步要由用户在界面上确认，不要替用户做',
        '新增 / 编辑 / 复制 / 删除 / 工艺矩阵 还没接后端（编辑弹窗能改能保存，但删除与工艺矩阵只有占位提示），' +
            '执行后回执会说明缺什么 —— 别把它们当成「数据已经改了」，也不要反复重试',
        '选完主表行再取明细：详情是异步加载的，选中命令的回执会等它落地；如果回执说没等到，稍后用 items.page 再试一次',
        'readable 为 false 的表，total 是 0 但意思是「不知道」——别回答「这一页没有数据」，先 tab.switch',
        '切过去后如果还是 0 行，可能是表格还在渲染，重试一次那张表的 page；仍然 0 行才是真的没有匹配数据',
        '配色/配码的格子可以编辑（色号、损耗数量、尺码用量），改完保存时才会汇总进 ColorMatch / SizeMatch',
        '配色与配码的列随数据变（有几个颜色/尺码就有几列），换一份 BOM 后列目录会整份刷新',
    ],
};

/**
 * 一次主表查询的结果。
 *
 * 桥的 `query.set` / `list.goto` 要等请求**真的回来**才回执：不等的话补丁里的行数与页码
 * 还是旧的，模型会以为换页没生效、再来一遍。页面负责在请求落地时把它交出来。
 */
export type MatrixListResult = {
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
export type BomMatrixBridgeContext = {
    /** 当前 View（菜单里配的那个） */
    view: string;
    /** 矩阵数据：三张明细表都由它派生 */
    bomMatrix: PackBomMatrix;
    /**
     * 最新矩阵（**ref 版**，不是 state）。
     *
     * 命令 handler 的 `await` 中途需要判断「详情到底落地没有」，那时它手上的 ctx 是命令启动时的闭包，
     * 里面的 `bomMatrix` 恒为旧值。这个函数每次都读 ref，所以能拿到最新值。
     */
    readMatrix: () => PackBomMatrix;
    /** 当前标签页（受控在页面上，控件不自己存） */
    activeKey: string;
    /** 取某张明细表的实例；没渲染过就是 null */
    readTable: (section: BomMatrixSection) => TableReadApi | null;
    /** 切标签页：页面负责落 state */
    setActiveKey: (key: string) => void;
    /**
     * 矩阵详情拉回来没有。
     *
     * 这一页需要 `ready`（别处列表页都不要）：**快照的结构本身依赖异步数据** ——
     * 配色/配码的列是按 `ColorSort` / `SizeSort` 生成的，数据没回来时那两张表只有物料列。
     * 不等就导航，模型先看到一份缺列的目录、拿到一个即将作废的 `fp`，还得再来一遍。
     */
    isReady: () => boolean;

    // ---- 主表（上方的包装 BOM 列表）----
    /** 当前查询条件（页面级 `query` 段就是它） */
    query: packBomMatrixListReq;
    /** 当前页码（从 1 起）与每页条数：翻页命令要按它夹范围 */
    page: number;
    pageSize: number;
    /** 服务端匹配总数（表格里只有当前页那 30 行，总数只有页面知道） */
    totalRows: number;
    /** 取主表的表格实例（`() => tableRef.current`） */
    readListTable: () => FilterTableApi | null;
    /**
     * 按新条件 / 页码重新查库，**等请求落地**再把结果交出来。
     *
     * 页面要把页码与条件一起夹好（越界的页夹到最后一页），并把结果里的 `total` 原样带回来 ——
     * 桥要用它算页数、写回执。
     */
    reloadList: (query: packBomMatrixListReq, page: number) => Promise<MatrixListResult>;
    /**
     * 页面顶部命令条（新增 / 编辑 / 复制 / 发布 / 工艺矩阵 / 删除 / 刷新）。
     *
     * 动作表**直接由它生成**：命令 ID 就是 `CommandItem.key`，点击执行的就是按钮自己的 `onClick`。
     * 另维护一份清单必然对不上 —— 页面上加个按钮，模型那儿就少一条命令。
     */
    commands: CommandItem[];
};

/** 主表「没渲染时」要说的话 */
const LIST_UNREADABLE = '包装 BOM 列表正在加载（首屏接口还没回来）：稍后重试，或重新 ui_observe';

/**
 * 命令条上「要对某一行动手」的按钮（编辑 / 复制 / 发布 / 工艺矩阵 / 删除）为什么点不动。
 *
 * 只有一条判据（有没有选中行），所以文案也只写一份 —— 分散到每个按钮上迟早会漂。
 */
const NEED_ROW_REASON = '需要先在主表选中一行：用 list.select 传它的 rowId（就是 PackBomMatrixID）';

/** 主表的默认投影列：模型多数时候只看这几列认单，其余用 fields 指名 */
const LIST_KEY_FIELDS = [
    'PackMaterialCode',
    'PackMaterialName',
    'ProjectCode',
    'PackMethod',
    'PackNum',
    'MatrixVersion',
];

const LIST_COLUMN_HINTS: Record<string, string> = {
    PackMaterialCode: '包装物料的编码：主表的「物料」查询条件就是它',
    PackMaterialName: '包装物料的名称',
    MatrixVersion: '矩阵版本：同一个包装物料可能有多份（不同版本各自一份矩阵）',
};

/** 子项物料的常用列：模型多数时候只看这几列，其余用 fields 指名 */
const ITEM_KEY_FIELDS = [
    'VRowNo',
    'MaterialCode',
    'MaterialName',
    'MaterialSpec',
    'Nitemnum',
    'CMeasure',
    'Ndissipationum',
    'Productor',
    'Fitemsource',
];

const ITEM_COLUMN_HINTS: Record<string, string> = {
    VRowNo: '行号：三张表共用这一套行号，跨表对行用它',
    Ndissipationum: '损耗系数，小数形式（0.03 = 3%）',
    Fitemsource: '备料来源：1=备料 2=领料 3=传输',
    Fbackflushtype: '倒冲方式：1=不倒冲 2=自动倒冲 3=交互式倒冲',
    ProjectMaterial: '项目专用料（勾选 = 只用于本项目）',
    Nitemnum: '子项数量',
    Ibasenum: '底数（与换算率一起决定单位换算）',
};

/**
 * 动态列的业务提示。
 *
 * 配色/配码的列名是拼出来的（`S260` / `N260` / 颜色名），列目录里只有名字，
 * 模型看不出 `S260` 是「260 码的尺码系数」。这里按当前尺码/颜色表补一句，
 * 换一份 BOM 就跟着换 —— 所以它必须跟着 `bomMatrix` 一起重建。
 */
function dynamicColumnHints(bomMatrix: PackBomMatrix): Record<string, string> {
    const hints: Record<string, string> = {VRowNo: '行号：与子项物料表同一套'};
    (bomMatrix.ColorSort ?? []).forEach((color) => {
        if (color) hints[color] = `${color} 色下的色号`;
    });
    (bomMatrix.SizeSort ?? []).forEach((size) => {
        if (!size) return;
        hints[`Sunhao${size}`] = `${size} 码的损耗数量`;
        hints[`S${size}`] = `${size} 码的尺码系数`;
        hints[`N${size}`] = `${size} 码的尺码用量`;
    });
    return hints;
}

/** 当前标签页（页面 state 是 string，认不出就退回默认页） */
function currentSection(ctx: BomMatrixBridgeContext): BomMatrixSection {
    return isBomMatrixSection(ctx.activeKey) ? ctx.activeKey : DEFAULT_BOM_MATRIX_SECTION;
}

/** 每张明细表「没渲染时」要说的话：指名道姓，比一句「表格还没建好」有用得多 */
function unreadableReason(ctx: BomMatrixBridgeContext, section: BomMatrixSection): string {
    const title = bomMatrixSectionLabel(section);
    return ctx.activeKey === section
        ? `「${title}」正在渲染，稍后重试，或重新 ui_observe`
        : `「${title}」此刻没打开：先用 tab.switch 把 key 设为 ${section}（切过去数据才会渲染）`;
}

/** 等一帧（表格把新 records 消化成显示行要一两帧） */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 16));
}

/** 等新标签页的表格真的能读：面板懒挂载，切过去之后才渲染 */
async function waitForTable(
    read: () => BomMatrixBridgeContext,
    section: BomMatrixSection,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // 三张表都由同一份 Detail 派生：明细本身就是空的，就不用再等「行数变成非 0」了
    const hasSourceRows = (read().bomMatrix.Detail ?? []).length > 0;
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
 * 等主表选中某一行之后，**矩阵详情与明细表都换成那一份**。
 *
 * 这一步不能省：`list.select` 之后详情是异步拉的，不给时间就回执，紧接着的 `items.page`
 * 拿到的还是上一个矩阵的行 —— 模型会把两份矩阵串在一起回答。
 *
 * 判定用 `readMatrix()`（ref）而不是 ctx 里的 `bomMatrix`：ctx 是命令启动时的闭包。
 * 除了 id 对上，还要等当前标签页那张表的行数与 `Detail` 一致（表格消化 records 要一两帧）。
 */
async function waitForMatrixDetail(
    read: () => BomMatrixBridgeContext,
    matrixID: string,
    timeoutMs = 1600,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ctx = read();
        const matrix = ctx.readMatrix();
        if (matrix.PackBomMatrixID === matrixID) {
            const table = ctx.readTable(currentSection(ctx));
            const expected = (matrix.Detail ?? []).length;
            if (table && table.getDisplayInfo().rowCount === expected) return true;
        }
        await nextFrame();
    }
    return false;
}

/** 等主表把新一页的数据渲染进表格（换页 / 换条件后 records 是 effect 里灌的） */
async function waitForListRows(
    read: () => BomMatrixBridgeContext,
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
 * 同一份数据既当「当前值」发布，也当 `query.set` 的参数说明 —— 一处维护，
 * 不会出现「快照里有这个条件、命令里却没有」这种对不上的情况。
 *
 * 与表上的 `list.filter` 分工：那是列头筛选面板（纯前端隐掉几行，桥自动读写），
 * 这里改完会**重新查库**。
 */
function currentQuery(query: packBomMatrixListReq): UIField[] {
    return [
        {
            id: 'PackMaterialCode',
            label: '物料（编码）',
            type: 'text',
            value: query.PackMaterialCode ?? '',
            hint: '按包装物料编码模糊查；留空 = 不限。改完会重新查库并回到第 1 页',
        },
    ];
}

/**
 * 装配本页的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象：快照与命令都在「被调用的那一刻」才读页面状态。
 * 唯一在建桥时就要定下来的是**列目录**（配色/配码的列跟着尺码/颜色表走），
 * 所以页面在 `bomMatrix` 变化时必须重建这个宿主 —— 列变了本来也该发整页快照。
 */
export function createBomMatrixBridge(read: () => BomMatrixBridgeContext): UIBridgeHost {
    const {bomMatrix} = read();
    const hints = dynamicColumnHints(bomMatrix);

    /** 主表：上方的包装 BOM 列表。选哪一行，决定下方三张表看的是哪个矩阵 */
    const list = createTableBridge({
        name: 'list',
        columns: MATRIX_LIST_COLUMNS,
        rowKey: 'PackBomMatrixID',
        readTable: () => read().readListTable(),
        unreadableReason: () => LIST_UNREADABLE,
        keyFields: LIST_KEY_FIELDS,
        columnHints: LIST_COLUMN_HINTS,
        // 选中 = 让下方换成这个矩阵的明细：不等详情落地就回执，接下来的 items.page 会取到上一份矩阵
        waitSelected: (rowId) => waitForMatrixDetail(read, rowId),
    });

    /** 三张明细表的读能力：name 是命令前缀，也是快照里的定位键 */
    const items = createTableBridge({
        name: 'items',
        columns: ITEM_COLUMNS,
        rowKey: 'PackBomMatrixDetailID',
        readTable: () => read().readTable('items'),
        unreadableReason: () => unreadableReason(read(), 'items'),
        keyFields: ITEM_KEY_FIELDS,
        columnHints: ITEM_COLUMN_HINTS,
    });
    const colors = createTableBridge({
        name: 'colors',
        columns: buildColorColumns(bomMatrix),
        // 三张表用同一个行标识（明细主键）：跨表对行可以直接拿 rowId，见 guide
        rowKey: 'PackBomMatrixDetailID',
        readTable: () => read().readTable('colors'),
        unreadableReason: () => unreadableReason(read(), 'colors'),
        columnHints: hints,
    });
    const sizes = createTableBridge({
        name: 'sizes',
        columns: buildSizeColumns(bomMatrix),
        rowKey: 'PackBomMatrixDetailID',
        readTable: () => read().readTable('sizes'),
        unreadableReason: () => unreadableReason(read(), 'sizes'),
        columnHints: hints,
    });

    /** 动作表：命令条 + 主表 + 查询 + 翻页 + 切标签页 + 三张明细表 */
    const actions = (): UIAction[] => [
        /*
         * 页面顶部那排按钮（新增 / 编辑 / 复制 / 发布 / 工艺矩阵 / 删除 / 刷新）。
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
                    name: 'PackMaterialCode',
                    type: 'text',
                    hint: '包装物料编码（模糊匹配）；传空串 = 不再按物料过滤',
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
                    hint: `第几页（从 1 起）。主表是服务端分页，每页 ${read().pageSize} 条；` +
                        `超出范围会停到最后一页`,
                },
            ],
        },
        {
            /*
             * 切标签页必须是一条显式命令：没切过去的表 readable:false，
             * 模型不切就永远读不到，「用 xxx 切过去」这句话需要一个能执行的东西。
             */
            id: 'tab.switch',
            label: '切换标签页',
            group: 'toolbar',
            params: [
                {
                    name: 'key',
                    type: 'select',
                    required: true,
                    options: BOM_MATRIX_SECTIONS.map((item) => item.key),
                    hint: `要切到哪一页：${BOM_MATRIX_SECTIONS.map((item) => `${item.key}=${item.label}`).join('、')}`,
                },
            ],
        },
        ...items.actions(),
        ...colors.actions(),
        ...sizes.actions(),
    ];

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const visibleOf = (section: BomMatrixSection) => ctx.activeKey === section;
        return {
            view: ctx.view,
            title: '包装 BOM 矩阵',
            mode: 'list',
            guide: BOM_MATRIX_GUIDE,
            actions: actions(),
            query: currentQuery(ctx.query),
            /*
             * 四张表都在 `tables` 里（没有「主表」这个特权位置），定位只认各自的 name。
             *
             * 数组顺序保持恒定（list → items → colors → sizes）：结构指纹里按 name 排序，
             * 但页面自己别去重排 —— 一份快照读下来，模型按顺序认表更省事。
             *
             * 主表常驻可见（`visible` 不传 = 看得见）；三张明细表的 `visible` 都跟着标签页走。
             */
            tables: [
                list.data(),
                items.data({visible: visibleOf('items')}),
                colors.data({visible: visibleOf('colors')}),
                sizes.data({visible: visibleOf('sizes')}),
            ],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {
        ...list.handlers,
        ...items.handlers,
        ...colors.handlers,
        ...sizes.handlers,

        /*
         * 改查询条件 → 重新查库 → 等列表真的换了再回执。
         *
         * 只认已知字段：页面 state 是业务对象，脏值进去只会让它带着脏值发请求。
         * 传空串是「去掉这个条件」，与筛选面板删掉一个条件同义。
         */
        'query.set': async (params) => {
            const ctx = read();
            const next: packBomMatrixListReq = {...ctx.query};
            /*
             * 「没传这个参数」= 不动它，「传空串」= 去掉这个条件 —— 两者必须分开：
             * 只按空串处理的话，模型少写一个字段就会把用户刚设的条件悄悄清掉。
             */
            if (params.PackMaterialCode !== undefined) {
                const code = toStringOrEmpty(params.PackMaterialCode).trim();
                if (code) next.PackMaterialCode = code;
                else delete next.PackMaterialCode;
            }

            // 换了条件一定回第 1 页：留在第 5 页看新条件的结果，多半是空的
            const result = await ctx.reloadList(next, 1);
            const scope = next.PackMaterialCode ? `物料「${next.PackMaterialCode}」` : '全部物料';
            if (!result.ok) {
                return `已按${scope}发起查询，但请求失败了（列表还是原来的样子）：先确认网络 / 后端，再重试一次`;
            }
            const landed = await waitForListRows(read, result.rows);
            if (!landed) {
                return `已按${scope}重新查询，但列表还没渲染出来：稍后用 list.page 取行`;
            }
            if (result.total === 0) return `已按${scope}重新查询：没有匹配的包装 BOM`;
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
            const pageSize = Math.max(1, ctx.pageSize);
            /*
             * 上界只在知道总数时才夹：首屏数据还没回来时 `totalRows` 是 0，
             * 按它算出来「最多 1 页」，会把要第 2 页的请求硬拽回第 1 页 —— 模型看到的是「翻页没反应」。
             */
            const maxPage = ctx.totalRows > 0 ? Math.max(1, Math.ceil(ctx.totalRows / pageSize)) : Infinity;
            const page = Math.min(wanted, maxPage);
            if (page === ctx.page) {
                // 已经在这一页：不重复查库，把此刻的状态报回去
                const table = ctx.readListTable();
                const rows = table?.getDisplayInfo().rowCount ?? 0;
                return `已经在第 ${page} 页（每页 ${pageSize} 条，共 ${ctx.totalRows} 条，本页 ${rows} 行）`;
            }
            const result = await ctx.reloadList(ctx.query, page);
            if (!result.ok) {
                return `翻页请求失败了（还停在第 ${ctx.page} 页，共 ${ctx.totalRows} 条）：先确认网络 / 后端，再重试一次`;
            }
            const landed = await waitForListRows(read, result.rows);
            const where = `第 ${result.page}/${Math.max(1, Math.ceil(result.total / pageSize))} 页`;
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
            if (!isBomMatrixSection(key)) {
                throw new Error(
                    `未知的标签页：${String(key)}。可选 ${BOM_MATRIX_SECTIONS.map((item) => item.key).join(' / ')}`,
                );
            }
            const ctx = read();
            if (ctx.activeKey === key) {
                // 已经在这一页：不重复切，直接把它此刻的样子报回去
                const table = ctx.readTable(key);
                const total = table?.getDisplayInfo().rowCount ?? 0;
                return `已经在「${bomMatrixSectionLabel(key)}」这一页（${total} 行）`;
            }
            ctx.setActiveKey(key);
            const landed = await waitForTable(read, key);
            const table = read().readTable(key);
            const total = table?.getDisplayInfo().rowCount ?? 0;
            if (!landed) {
                return `已切到「${bomMatrixSectionLabel(key)}」，但表格还没渲染出来：稍后用 ${key}.page 读一次`;
            }
            if (total === 0) {
                /*
                 * 不说「没有数据」：分不清「还在渲染」和「确实没有」。
                 * 让模型自己用 page 确认一次，比替它下一个可能是错的结论便宜。
                 */
                return `已切到「${bomMatrixSectionLabel(key)}」，表格当前 0 行（可能还在渲染，也可能这一页没有数据）：` +
                    `用 ${key}.page 读一次确认`;
            }
            return `已切到「${bomMatrixSectionLabel(key)}」（${total} 行），用 ${key}.page 取行`;
        },
    };

    /*
     * 命令条上的每条按钮**直接用它自己的 onClick**，不另写一份实现 —— 抄一份的代价是行为分叉：
     * 按钮改了、agent 那条没改，或者反过来。这里只包一层，顺便回一句人话给模型当回执
     * （否则 result 是 null，模型只能猜按钮到底按下去没有）。
     *
     * 按 key 重新取最新那份命令：`disabled` 依赖选中行，建桥时闭包里那份可能已经过期。
     */
    read().commands.forEach((item) => {
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
             * 所以这里如实说三件事：已触发、还没生效、别重复调用（再调就是第二个框）。
             */
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但**还没有生效**：界面上弹出了确认框，用户点「确认」之后才会执行。` +
                    '不要重复调用这条命令（会再弹一个框）；确认结果以稍后重新 ui_observe / 读表格为准';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {snapshot, handlers, ready: () => read().isReady()};
}
