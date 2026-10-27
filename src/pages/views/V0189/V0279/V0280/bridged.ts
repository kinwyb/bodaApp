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

import type {YupaiOrder, YupaiOrderQuery} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';

/**
 * 界面桥用的识别列：能让 agent 指认一行的字段，**不是全部列**。
 * 完整列定义给表格用，这里只挑几个够定位的，避免把整张表塞进模型上下文。
 */
const SNAPSHOT_COLUMNS = [
    {field: 'OrderCode', title: '订单号'},
    {field: 'YPDate', title: '预订日期'},
    {field: 'Ywy', title: '业务员'},
    {field: 'Qty', title: '总数量'},
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
        '删除 / 发布 / 分批 / 复制 要求先选中一行：本页还没开放选择命令，需要请用户在表格里点选',
        '新增 / 编辑 会打开表单弹窗，弹出后快照会切成表单那一层（见它自己的 guide）',
    ],
    terms: {
        产地: 'workPlace，只可选「越南工厂,义乌工厂」',
        业务员: 'salesman',
        关键字: 'keyword',
    },
    cautions: ['命令被禁用时先看 disabledReason，不要反复重试'],
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
function toQueryPatch(params: Record<string, unknown>): YupaiOrderQuery {
    const patch: YupaiOrderQuery = {page: 1};
    if (typeof params.keyword === 'string') patch.keyword = params.keyword;
    if (typeof params.salesman === 'string') patch.salesman = params.salesman;
    if (typeof params.workPlace === 'string') patch.workPlace = params.workPlace;
    if (typeof params.isDel === 'boolean') patch.isDel = params.isDel ? 1 : 0;
    return patch;
}

/**
 * 快照里的筛选条件：同一份数据既当「当前值」发布，也当 filter.set 的参数声明 ——
 * 一处维护，不会出现「filters 里有产地、命令里却没有」这种对不上的情况。
 */
function currentFilters(query: YupaiOrderQuery): UIField[] {
    return [
        {id: 'keyword', label: '关键字', type: 'text', value: query.keyword ?? ''},
        {id: 'salesman', label: '业务员', type: 'text', value: query.salesman ?? ''},
        {id: 'workPlace', label: '产地', type: 'text', value: query.workPlace ?? ''},
        {id: 'isDel', label: '包含已删除', type: 'switch', value: query.isDel === 1},
    ];
}

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type YupaiOrderBridgeContext = {
    /** 当前 View（可能带子级，菜单里配的就是它） */
    view: string;
    /** 命令条上的命令项：动作表与页面按钮同源 */
    commands: CommandItem[];
    /** 当前查询条件 */
    query: YupaiOrderQuery;
    /** 当前页数据 */
    dataSource: YupaiOrder[];
    /** 后端总数 */
    total: number;
    /** 当前激活行 */
    activeRow: YupaiOrder | null;
    /** 选中行数（只驱动 disabled，行数据向表格要） */
    activeRowCount: number;
    /** 列表是否已加载完成；ui_navigate 打开本页后会等它 */
    ready: boolean;
    /** 用新条件重新查询：页面负责落 state 并拉数据 */
    applyQuery: (next: YupaiOrderQuery) => Promise<void>;
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
        const filters = currentFilters(ctx.query);
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
                    disabledReason: item.disabled ? '需要先选择一行' : undefined,
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
            ],
            filters,
            selection: {
                count: ctx.activeRowCount,
                activeRowId: ctx.activeRow?.ID ?? null,
                rowIds: ctx.activeRow ? [ctx.activeRow.ID] : [],
            },
            data: {
                total: ctx.total,
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
        await ctx.applyQuery({...ctx.query, ...toQueryPatch(params)});
        return `已按 ${JSON.stringify(params)} 重新查询`;
    };

    return handlers;
}
