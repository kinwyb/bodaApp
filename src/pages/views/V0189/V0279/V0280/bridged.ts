/**
 * V0189_V0279_V0280（计划管理 > 预订单 > 预订单管理）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身 ——
 * 页面功能不受影响，但模型既看不到这一页、也不会把它列进可导航清单。
 *
 * 两条约束：
 * - 只放常量与纯函数：不导出组件、不调 hook。页面把「怎么取当前状态」以取值函数传进来，
 *   工厂只做装配 —— 在工厂里调 hook 会变成「在页面的 hook 回调里调 hook」。
 * - 不重复描述命令：动作表直接来自页面的 `commands`（就是 CommandBar 的按钮），
 *   命令 ID 就是 `CommandItem.key`，另维护一份清单必然对不上。
 */

import type {YupaiOrder} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';

export interface YupaiOrderFilter {
    WorkPlace?: string,
    OrderCode?: string,
    YPDate?: string,
    Ywy?: string,
}

/**
 * 界面桥用的识别列：能让 agent 指认一行的字段，**不是全部列**。
 * 完整列定义给表格用，这里只挑几个够定位的，避免把整张表塞进模型上下文。
 */
const SNAPSHOT_COLUMNS = [
    {field: 'WorkPlace', title: '生产产地'},
    {field: 'OrderCode', title: '订单号'},
    {field: 'YPDate', title: '预订日期'},
    {field: 'Ywy', title: '业务员'},
];

/** 快照一次最多给多少行；超出部分靠筛选缩小范围，而不是全量塞给模型 */
const SNAPSHOT_ROW_LIMIT = 20;

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
        '改条件用 filter.set（参数名见该 action 的 params），等列表变成你要的范围再动单据',
        '删除 / 发布 / 分批 / 复制 / 设置 要求先选中行：用 selection.set 传 rowIds（取快照 data.rows[].rowId）',
        '新增 / 编辑 会打开表单弹窗，弹出后快照会切成表单那一层（见它自己的 guide）',
    ],
    terms: {
        生产产地: 'WorkPlace，只可选「越南工厂,义乌工厂」',
        rowId: '单据的业务主键（不用行号：排序一变行号就全错）',
    },
    cautions: [
        '命令被禁用时先看 disabledReason，不要反复重试',
        'selection.set 只认当前列表里存在的行：目标被筛掉了就先用 filter.set 放宽条件',
    ],
};

/** 取一行的识别列，行 ID 用业务主键（不是行号 —— 排序一变行号就全错） */
function snapshotRow(record: YupaiOrder): Record<string, unknown> {
    const source = record as unknown as Record<string, unknown>;
    const picked: Record<string, unknown> = {rowId: source.ID};
    SNAPSHOT_COLUMNS.forEach((column) => {
        picked[column.field] = source[column.field];
    });
    return picked;
}

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
 * 解析 rowIds：模型可能给数组、JSON 字符串、逗号分隔的一串，或者干脆只给一个。
 *
 * 这几种都实测出现过（服务端只透传不校验），所以统一收口在这里 ——
 * handler 里再挨个 `typeof` 判一遍的话，每个需要多值的命令都要抄一份。
 */
function toRowIdList(value: unknown): string[] {
    const single = (item: unknown): string => (item == null ? '' : String(item).trim());
    if (Array.isArray(value)) return value.map(single).filter(Boolean);
    if (typeof value === 'string') {
        const text = value.trim();
        // JSON 数组字符串（模型序列化过一遍）
        if (text.startsWith('[')) {
            try {
                const parsed: unknown = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed.map(single).filter(Boolean);
            } catch {
                // 不是合法 JSON 就按分隔符处理，下面接着走
            }
        }
        return text.split(/[,，;；\s]+/).map(single).filter(Boolean);
    }
    const one = single(value);
    return one ? [one] : [];
}

/**
 * 等页面把选中态落回 state。
 *
 * `selectRows` 只把选中写进表格实例，页面的 `activeRow` / `activeRowCount` 是表格回调驱动的
 * React state，要到下一次渲染才更新。立刻回执的话快照里 selection 仍是空的，
 * 模型会以为没选中，接着再调一次 —— 轮询比「等一帧」稳（并发渲染可能推迟几帧）。
 */
async function waitForActiveRow(
    read: () => YupaiOrderBridgeContext,
    rowId: string,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (toStringOrEmpty(read().activeRow?.ID) === rowId) return true;
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
    /**
     * **用户当前看到的数据**（筛选后的那批行），不是接口原始数据。
     *
     * 页面对它做了筛选：被筛掉的行不在这里。快照的 total / rows 都以它为准 ——
     * 换成原始 dataSource 会让模型描述出用户屏幕上没有的行。
     */
    dataSource: YupaiOrder[];
    /** 当前激活行 */
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
     * 按行主键选中行（整行替换，不是追加），返回实际命中的行数。
     *
     * 页面负责「写进表格」这件事（`tableRef.current.selectRowsByKeys`），
     * 桥只管把 rowId 翻成调用 —— 行主键 → 显示行号的换算只有表格自己知道（排序/分组）。
     */
    selectRows: (rowIds: string[]) => number;
};

/**
 * 装配本页的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象本身：桥的 snapshot / handler 都在「被调用的那一刻」
 * 才去读页面状态。宿主对象因此可以长期不变，而读到的永远是最新的 query、选中行与命令表
 * （这与 `registerPageHost` 存 getter 而不是存快照是同一个理由）。
 */
export function createYupaiOrderBridge(read: () => YupaiOrderBridgeContext): UIBridgeHost {
    /*
     * 页面这一层只描述列表。
     *
     * 弹窗打开时的覆盖（动作换成 form.*、列表数据收起、guide 换成表单那份）由桥统一做，
     * 弹窗自己注册 —— 所以这里没有任何 form 相关的分支，页面也不需要认识弹窗的字段。
     */
    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const filters = currentFilters(ctx.filter);
        const rows = ctx.dataSource.slice(0, SNAPSHOT_ROW_LIMIT).map(snapshotRow);
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
                    // 本页命令的 disabled 几乎都来自「没有选中行」，写清原因省得模型反复试错
                    disabledReason: item.disabled ? '需要先选中一行：用 selection.set 传 rowIds' : undefined,
                })),
                {
                    // 改筛选条件本身也是一条命令。只发 filters 不发命令，模型就只能干猜
                    id: 'filter.set',
                    label: '设置筛选条件',
                    group: 'filter' as const,
                    params: filters.map((field) => ({
                        name: field.id,
                        type: field.type,
                        hint: field.label,
                    })),
                },
                {
                    // 选中行也是一条命令：selection 段只说明「当前选中了什么」，
                    // 不发命令的话模型只能请用户手动点 —— 而「选中后执行命令」正是本页的主流程
                    id: 'selection.set',
                    label: '选中行',
                    group: 'row' as const,
                    params: [
                        {
                            name: 'rowIds',
                            type: 'text' as const,
                            required: true,
                            hint: '要选中的行 rowId，多个用逗号分隔（取快照 data.rows[].rowId）',
                        },
                    ],
                },
            ],
            filters,
            selection: {
                count: ctx.activeRowCount,
                activeRowId: ctx.activeRow?.ID ?? null,
                rowIds: ctx.activeRow ? [ctx.activeRow.ID] : [],
            },
            data: {
                total: ctx.dataSource.length,
                loaded: ctx.dataSource.length,
                shown: rows.length,
                truncated: rows.length < ctx.dataSource.length,
                columns: SNAPSHOT_COLUMNS,
                rows,
                active: ctx.activeRow ? snapshotRow(ctx.activeRow) : undefined,
            },
        };
    };

    return {
        snapshot,
        handlers: buildHandlers(read),
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
     * 这里等查询真的返回再回执：否则回执里那份快照还是旧数据，
     * 模型会以为筛选没生效（页面的 useEffect 也会因 query 变化再拉一次，
     * 两个请求内容一致，真实实现应收敛成一条加载路径）。
     */
    handlers['filter.set'] = async (params) => {
        const ctx = read();
        await ctx.applyFilter({...ctx.filter, ...toQueryPatch(params)});
        return `已按 ${JSON.stringify(params)} 重新过滤`;
    };

    /**
     * 语义命令：选中行（整份替换）。
     *
     * 只认**当前列表里存在**的行 —— 被筛掉的行在表格里没有显示行号，选不中。
     * 静默忽略最危险：模型以为选上了，接着点删除就会删错单，所以这里点名回报。
     */
    handlers['selection.set'] = async (params) => {
        const rowIds = toRowIdList(params.rowIds ?? params.rowId);
        if (rowIds.length === 0) {
            throw new Error(
                'selection.set 需要 rowIds：从快照 data.rows[].rowId 里取，多个用逗号分隔',
            );
        }
        const visible = new Set(read().dataSource.map((record) => toStringOrEmpty(record.ID)));
        const hits = rowIds.filter((id) => visible.has(id));
        const missing = rowIds.filter((id) => !visible.has(id));
        if (hits.length === 0) {
            throw new Error(
                `rowId 都不在当前列表里（${missing.join('、')}）：可能被筛选掉了，` +
                '先用 filter.set 放宽条件，或从最新快照的 data.rows 里取 rowId',
            );
        }
        const selected = read().selectRows(hits);
        // 选中写进表格后，页面的 activeRow 要等下一次渲染才有 —— 不等的话回执里的快照还是空的
        const landed = await waitForActiveRow(read, hits[0]);
        const parts = [`已选中 ${selected} 行（rowId：${hits.join('、')}）`];
        if (selected < hits.length) {
            parts.push(`其中 ${hits.length - selected} 行没选中（不在表格里，可能在分组里被收起了）`);
        }
        if (missing.length > 0) {
            parts.push(`未找到 ${missing.join('、')}（可能被筛掉或主键写错）`);
        }
        if (!landed) {
            parts.push('界面还没回传选中态，稍后 observe 一次再确认');
        }
        return parts.join('；');
    };

    return handlers;
}
