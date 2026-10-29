/**
 * V0277_V0354（包装 BOM 矩阵）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身。
 *
 * 这一页是「一页多表」的第一个样本：三个标签页 = 三张表，同一时刻只有一张在屏幕上。
 * 所以它示范的是**多表怎么拼**，不是「多页怎么拼」：
 *
 * - 三张表的目录**全部常驻**快照（`tables[]` 的三个元素），列定义与视图共用 `./columns`；
 * - 只有数据按需取（`items.page` / `colors.page` / `sizes.page`）；
 * - 「此刻能不能读」由 `readable` 说、「用户看不看得见」由 `visible` 说 ——
 *   两个都不进结构指纹，所以切标签页只回一条补丁，而不是整页重发。
 *
 * 三条写法约束（与 V0189_V0279_V0280 的 bridged.ts 一致）：只放常量与纯函数，
 * 不导出组件、不调 hook；页面把「怎么取当前状态」以取值函数传进来。
 */

import type {TableReadApi} from '@/pages/agent/ui-bridge';
import type {UIAction, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import type {BomMatrix} from '@/api/schemas/nc/bomMatrix.ts';
import {buildColorColumns, buildSizeColumns, ITEM_COLUMNS} from '@/components/nc/bomMatrix/columns.ts';
import {
    BOM_MATRIX_SECTIONS,
    bomMatrixSectionLabel,
    isBomMatrixSection,
    type BomMatrixSection,
} from '@/components/nc/bomMatrix/sections.ts';

/**
 * 本页自述：告诉 agent 这一页该怎么操作。
 *
 * 三条禁忌同协议：不写命令清单（命令已经在 actions 里）、不从页面数据生成、不替控件转述。
 * 这里的重点是**标签页这条界面约束** —— 不写清楚，模型会拿 `total: 0` 当成「这页没数据」。
 */
const BOM_MATRIX_GUIDE: UIGuide = {
    summary: '包装 BOM 矩阵：一个包装物料下的子项物料清单，以及它按颜色 / 尺码展开的两种视图',
    steps: [
        '三张表是**同一批子项行的三种看法**，但界面同一时刻只渲染一个标签页：' +
            '要读哪一张先用 tab.switch 切过去，切过去之后那张表的 total 才是真的',
        '取数各用各的前缀：子项物料 items.page、配色 colors.page、配码 sizes.page（行号从 0 起，与屏幕一致）',
        'tables 里 name=items 的那张永远是「子项物料」；切到配色/配码后它的 visible 会变成 false —— ' +
            '用户说的「这一行」指的是 visible 为 true 的那张表',
        'colors / sizes 的行与 items 一一对应（同一个子项物料一行），跨表对行用 VRowNo，不要拿 rowId 互相套',
    ],
    terms: {
        子项物料: 'items，包装 BOM 的明细行，一行一个物料（唯一在界面上可编辑的一张）',
        配色: 'colors，每列一个缝制颜色，格子里是该颜色下这个物料的色号',
        配码: 'sizes，每个尺码三列：损耗数量 / 尺码系数 / 尺码用量',
        标签页: '三个 tab，key 分别是 items / colors / sizes',
        损耗系数: 'Ndissipationum，小数形式（0.03 = 3%）',
    },
    cautions: [
        'readable 为 false 的表，total 是 0 但意思是「不知道」——别回答「这一页没有数据」，先 tab.switch',
        '切过去后如果还是 0 行，可能是表格还在渲染，重试一次那张表的 page；仍然 0 行才是真的没有匹配数据',
        'colors / sizes 的 rowId 是「行号_物料VID」拼出来的，items 的 rowId 是明细主键 —— 两套键不通用',
        '配色与配码的列随数据变（有几个颜色/尺码就有几列），换一份 BOM 后列目录会整份刷新',
    ],
};

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type BomMatrixBridgeContext = {
    /** 当前 View（菜单里配的那个） */
    view: string;
    /** 矩阵数据：三张表都由它派生 */
    bomMatrix: BomMatrix;
    /** 当前标签页（受控在页面上，控件不自己存） */
    activeKey: string;
    /** 取某张表的实例；没渲染过就是 null */
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
};

/** 每张表「没渲染时」要说的话：指名道姓，比一句「表格还没建好」有用得多 */
function unreadableReason(ctx: BomMatrixBridgeContext, section: BomMatrixSection): string {
    const title = bomMatrixSectionLabel(section);
    return ctx.activeKey === section
        ? `「${title}」正在渲染，稍后重试，或重新 ui_observe`
        : `「${title}」此刻没打开：先用 tab.switch 把 key 设为 ${section}（切过去数据才会渲染）`;
}

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
function dynamicColumnHints(bomMatrix: BomMatrix): Record<string, string> {
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
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return read().readTable(section) !== null;
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

    /** 三张表的读能力：name 是命令前缀，也是快照里的定位键 */
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
        rowKey: 'Key',
        readTable: () => read().readTable('colors'),
        unreadableReason: () => unreadableReason(read(), 'colors'),
        columnHints: hints,
    });
    const sizes = createTableBridge({
        name: 'sizes',
        columns: buildSizeColumns(bomMatrix),
        rowKey: 'Key',
        readTable: () => read().readTable('sizes'),
        unreadableReason: () => unreadableReason(read(), 'sizes'),
        columnHints: hints,
    });

    /** 三张表 + 一条切标签页，动作表固定不变（切 tab 才不会推动结构指纹） */
    const actions = (): UIAction[] => [
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
            /*
             * 三张表都进 `tables`（没有「主表」这个特权位置了），定位只认各自的 name。
             *
             * 数组顺序保持恒定（items → colors → sizes）：结构指纹里按 name 排序，
             * 但页面自己别去重排 —— 一份快照读下来，模型按顺序认表更省事。
             *
             * 三张表的 `visible` 都跟着标签页走：只有一张为 true，其余为 false。
             */
            tables: [
                items.data({visible: visibleOf('items')}),
                colors.data({visible: visibleOf('colors')}),
                sizes.data({visible: visibleOf('sizes')}),
            ],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {
        ...items.handlers,
        ...colors.handlers,
        ...sizes.handlers,
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

    return {snapshot, handlers, ready: () => read().isReady()};
}
