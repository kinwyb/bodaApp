/**
 * V0018_V0112（生产看板 > 常规报表）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**。
 *
 * 这一页的特殊点：报表目录里有大量报表且名称常常相近，选错报表查出来的数据
 * 看起来也「像对的」。所以查询链路设了两道确认：
 * 1. guide 要求 agent 在提交前把候选报表与条件复述给用户核对；
 * 2. report.query 是 waitConfirm 动作 —— 只弹确认框（列出报表与全部条件），
 *    用户在界面上点「执行查询」才真正查库，终态经 action.outcome 事件上报。
 *
 * 查询条件直接来自报表目录的 Args，agent 不需要打开「查询条件」弹窗 ——
 * 那个弹窗只是用户手动填条件的入口，保持原样、不接桥。
 *
 * 表格列随报表动态变化：columns 由页面经 context 传入，查完一张新报表后
 * context 变化重建桥，列目录的结构差异由公共桥自动发 full。
 */
import {sqlApi} from '@/api';
import type {BIList, BIQueryArg} from '@/api/modules/bi';
import {ErrorMessage} from '@/api/request';
import type {GridTableApi} from '@/components/grid-table';
import type {ColumnsDefine} from '@visactor/vtable';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {
    createTableBridge,
    type FormFieldSpec,
    normalizeFieldValue,
    resolveFieldEntries,
    type UIBridgeHandler,
    type UIBridgeHost,
} from '@/pages/agent/ui-bridge';
import {ORG_ID, ORG_NAME, ORGS} from '@/store/orgs';
import {formatDate, isBlank, toStringOrEmpty} from '@/utils';
import dayjs from 'dayjs';

/** 报表行没有业务主键：biTable 给每行注入 _rowKey（本次查询结果的序号） */
export const BI_REPORT_ROW_KEY = '_rowKey';

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type BIReportBridgeContext = {
    view: string;
    /** 报表目录树（biApi.list 的原始结构，Args 里带着每个报表的查询条件） */
    reports: BIList[];
    reportsLoading: boolean;
    /** 最近一次确认查询的报表（含条件）；undefined = 还没查过 */
    queryNode?: BIList;
    /** 结果表的列目录（随报表变化） */
    tableColumns: ColumnsDefine;
    tableLoading: boolean;
    /** 查询确认框是否已弹出（弹出期间拒绝重复提交） */
    confirming: boolean;
    readTable: () => GridTableApi | null;
    /** 弹确认框列出报表与条件；用户确认后才真正执行查询（页面实现） */
    confirmQuery: (draft: BIList, path: string) => void;
};

const GUIDE: UIGuide = {
    summary: '基本常规报表：从报表目录中选择报表、设置查询条件后在右侧表格查看结果；报表多且名称相近，查询前必须与用户确认报表与条件',
    steps: [
        'reports.find 按关键字找报表（返回 reportId / 名称 / 目录路径 / 条件清单）；名称相近的报表很多，' +
        '先把候选报表连同目录路径摆给用户确认是哪一个，不要自行猜测',
        '条件就在报表目录的 args 里（field = 字段 id，name = 界面显示名）；组织与带候选的条件用 report.options 取候选值',
        '与用户核对报表名与每个条件值后执行 report.query：reportId + values（{字段id或条件名: 值}，一次传齐）；' +
        '未传的条件用报表默认值，传空串表示清空该条件',
        'report.query 只弹确认框，用户在界面上点「执行查询」才真正查库；终态看 action.outcome 事件，不要重复提交',
        '查询落地后用 data.page 按显示行号取数（offset 0 = 用户屏幕第 1 行）；换报表后列目录会变，先重新 ui_observe',
    ],
    terms: {
        报表: 'BIList，reportId = ID；只有带 QuerySQL 的节点才可查询，目录节点只用来组织层级',
        条件: 'Args，字段 id = Field、界面显示名 = Name；type=date 的条件填 YYYY-MM-DD',
        组织: '名称为「组织」的条件填组织 ID 或工厂名（候选用 report.options 取：义乌工厂 / 越南工厂 / 供应链 / 顺杰 / 硕杰）',
    },
    cautions: [
        '报表内容相近：查询前必须与用户确认「是这张报表、条件正确」；report.query 的界面确认框是最后一道闸，' +
        'agent 没有替用户点确认的能力',
        '「查询条件」弹窗是用户手动填条件的入口，agent 不需要也不要试图操作它；条件直接用 report.query 的 values 传',
        'data 表行没有业务主键：rowId（_rowKey）是本次查询结果的序号，重新查询后会变，不能跨查询引用',
        'data.total 含底部合计行（数值列求和）；回答「共几条明细」时要减掉合计行',
        '条件留空通常表示不限（具体由报表 SQL 决定）；与用户核对条件时把未填的也念出来',
        'query 段是最近一次已执行查询的报表与条件（只读）；改条件重新执行 report.query 即可',
    ],
};

/** 摊平报表目录：带 QuerySQL 的节点可查询，path 是它所在的目录链（不含自身名） */
export function flattenReports(nodes: BIList[], parents: string[] = []): Array<{ node: BIList; path: string }> {
    const out: Array<{ node: BIList; path: string }> = [];
    nodes.forEach((node) => {
        if (node.QuerySQL) {
            out.push({node, path: parents.join(' / ')});
        }
        if (node.Children && node.Children.length > 0) {
            out.push(...flattenReports(node.Children, [...parents, node.BIName]));
        }
    });
    return out;
}

/** 条件 → 字段规格：与 biQuery 弹窗的控件规则同源（组织下拉 / 日期 / 文本） */
function argSpec(arg: BIQueryArg): FormFieldSpec {
    if (arg.Name.trim() === '组织') {
        return {id: arg.Field, label: arg.Name, type: 'select', options: Object.keys(ORGS)};
    }
    if (arg.ValType.toLowerCase() === 'date') {
        return {id: arg.Field, label: arg.Name, type: 'date'};
    }
    return {id: arg.Field, label: arg.Name, type: 'text'};
}

function isOrgArg(arg: BIQueryArg): boolean {
    return arg.Name.trim() === '组织';
}

/** 条件的显示值：组织翻译成工厂名，空值统一说「未填」 */
function displayArgValue(arg: BIQueryArg): string {
    if (!arg.Val) return '(未填)';
    return isOrgArg(arg) ? ORG_NAME(arg.Val) : arg.Val;
}

/** 最近一次查询的报表与条件（只读展示；修改入口是 report.query） */
function currentQuery(ctx: BIReportBridgeContext): UIField[] | undefined {
    const node = ctx.queryNode;
    if (!node) return undefined;
    const fields: UIField[] = [{
        id: '__report',
        label: '当前报表',
        type: 'readonly',
        value: node.BIName,
        hint: '换报表或改条件：report.query 传 reportId 与 values（需用户在确认框上确认）',
    }];
    node.Args.forEach((arg) => {
        fields.push({
            id: arg.Field,
            label: arg.Name,
            type: 'readonly',
            value: displayArgValue(arg),
            hint: isOrgArg(arg) && arg.Val ? `组织 ID：${arg.Val}` : undefined,
        });
    });
    return fields;
}

/** reports.find 一次最多回多少条：目录很大，全量下发既贵又没法核对 */
const FIND_LIMIT = 30;
/** report.options 一次最多回多少个候选值 */
const OPTIONS_LIMIT = 100;

/** 按 reportId 找可查询的报表；找不到时给模型可行动的下一步 */
function requireReport(ctx: BIReportBridgeContext, reportId: string): { node: BIList; path: string } {
    const entry = flattenReports(ctx.reports).find((item) => item.node.ID === reportId);
    if (!entry) {
        throw new Error(`没找到 reportId=${reportId} 的报表：目录可能已刷新，用 reports.find 重新取候选`);
    }
    return entry;
}

/** values → 条件草稿：拷贝 Args（不动目录树里的默认值），逐条校验后写入 */
function buildDraft(node: BIList, values: unknown): BIList {
    const args = node.Args.map((arg) => ({...arg}));
    if (isBlank(values)) return {...node, Args: args};
    const specs = node.Args.map(argSpec);
    const resolved = resolveFieldEntries(values, specs);
    if (!resolved) {
        throw new Error('values 要是 {字段id或条件名: 值} 的对象（或它的 JSON 字符串）');
    }
    if (resolved.unknownKeys.length > 0) {
        throw new Error(
            `不认识的条件：${resolved.unknownKeys.join('、')}。` +
            `可用条件：${specs.map((spec) => `${spec.id}(${spec.label})`).join('、') || '该报表没有条件'}`,
        );
    }
    for (const {field, value} of resolved.entries) {
        const arg = args.find((item) => item.Field === field.id);
        if (!arg) continue;
        const text = toStringOrEmpty(value).trim();
        // 空串 = 清空该条件（界面上就是 allowClear 清掉）
        if (text === '') {
            arg.Val = '';
            continue;
        }
        // 组织条件：ID 与工厂名都认，统一落成 ID
        const next = isOrgArg(arg) && !ORGS[text] ? (ORG_ID(text) || text) : value;
        const normalized = normalizeFieldValue(field, next);
        if (!normalized.ok) {
            throw new Error(`条件「${field.label}」${normalized.reason}`);
        }
        arg.Val = dayjs.isDayjs(normalized.value) ? formatDate(normalized.value) : toStringOrEmpty(normalized.value);
    }
    return {...node, Args: args};
}

export function createBIReportBridge(read: () => BIReportBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().tableColumns,
        rowKey: BI_REPORT_ROW_KEY,
        readTable: () => read().readTable(),
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'reports.find': (params) => {
            const ctx = read();
            if (ctx.reportsLoading) {
                return '报表目录还在加载（或加载失败）：稍后重试；一直为空请让用户检查页面左侧目录';
            }
            const entries = flattenReports(ctx.reports);
            if (entries.length === 0) {
                return '报表目录为空：请让用户确认账号权限或刷新页面';
            }
            const keyword = toStringOrEmpty(params.keyword).trim().toLowerCase();
            const matched = keyword
                ? entries.filter((entry) => `${entry.node.BIName} ${entry.path}`.toLowerCase().includes(keyword))
                : entries;
            const reports = matched.slice(0, FIND_LIMIT).map((entry) => ({
                reportId: entry.node.ID,
                name: entry.node.BIName,
                path: entry.path || '(根目录)',
                args: entry.node.Args.map((arg) => ({
                    field: arg.Field,
                    name: arg.Name,
                    type: arg.ValType.toLowerCase(),
                    value: arg.Val || '',
                    hasOptions: isOrgArg(arg) || !!arg.SQL?.trim(),
                })),
            }));
            return {
                total: matched.length,
                returned: reports.length,
                reports,
                note: matched.length > FIND_LIMIT
                    ? `只返回前 ${FIND_LIMIT} 条：请加 keyword 缩小范围`
                    : '名称相近的报表很多：把候选报表名与目录路径给用户确认后，再 report.query',
            };
        },
        'report.options': async (params) => {
            const ctx = read();
            const reportId = toStringOrEmpty(params.reportId).trim();
            const field = toStringOrEmpty(params.field).trim();
            if (!reportId || !field) {
                throw new Error('需要 reportId（来自 reports.find）与 field（条件 id，见 reports.find 的 args[].field）');
            }
            const {node} = requireReport(ctx, reportId);
            const arg = node.Args.find((item) => item.Field === field);
            if (!arg) {
                throw new Error(
                    `报表「${node.BIName}」没有条件 ${field}：可用条件 ` +
                    `${node.Args.map((item) => `${item.Field}(${item.Name})`).join('、') || '为空'}`,
                );
            }
            const match = toStringOrEmpty(params.match).trim().toLowerCase();
            if (isOrgArg(arg)) {
                const values = Object.entries(ORGS)
                    .filter(([id, name]) => !match || id.toLowerCase().includes(match) || name.toLowerCase().includes(match))
                    .map(([id, name]) => ({value: id, label: name}));
                return {field, values, note: 'values 里 value（组织 ID）与 label（工厂名）都可以填'};
            }
            if (!arg.SQL?.trim()) {
                return {
                    field,
                    values: [],
                    note: arg.ValType.toLowerCase() === 'date'
                        ? '日期条件没有候选值，直接填 YYYY-MM-DD'
                        : '该条件没有候选值，直接填文本',
                };
            }
            // 与弹窗里快捷选择同源：跑条件自带的 SQL，取「条件名」那一列
            let rows: Record<string, unknown>[] = [];
            let headers: string[] = [];
            try {
                const result = await sqlApi.query({SQL: arg.SQL});
                rows = result.data?.DataVals ?? [];
                headers = result.data?.Headers ?? [];
            } catch (error) {
                throw new Error(ErrorMessage(error, `条件「${arg.Name}」候选值查询失败`));
            }
            const column = headers.includes(arg.Name) ? arg.Name : headers[0];
            if (!column) return {field, values: [], note: '候选查询没有返回数据'};
            const seen = new Set<string>();
            const values: string[] = [];
            rows.forEach((row) => {
                const value = toStringOrEmpty(row[column]).trim();
                if (!value || seen.has(value)) return;
                if (match && !value.toLowerCase().includes(match)) return;
                seen.add(value);
                values.push(value);
            });
            return {
                field,
                column,
                total: values.length,
                values: values.slice(0, OPTIONS_LIMIT),
                note: values.length > OPTIONS_LIMIT ? `只返回前 ${OPTIONS_LIMIT} 个：可传 match 缩小范围` : undefined,
            };
        },
        'report.query': (params) => {
            const ctx = read();
            if (ctx.confirming) {
                throw new Error('查询确认框已经弹出：等用户确认或取消，不要重复提交');
            }
            const reportId = toStringOrEmpty(params.reportId).trim();
            if (!reportId) {
                throw new Error('需要 reportId：先用 reports.find 取候选，并与用户确认是哪一个报表');
            }
            const {node, path} = requireReport(ctx, reportId);
            const draft = buildDraft(node, params.values);
            ctx.confirmQuery(draft, path);
            return `已弹出查询确认框：报表「${node.BIName}」（${path || '根目录'}）与全部条件已列出，` +
                '等用户在界面上点「执行查询」。查询尚未执行：终态以 action.outcome 事件为准，不要重复调用';
        },
    };

    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const unreadable = !ctx.queryNode
                ? '还没有查询任何报表：先 reports.find 找报表并与用户确认，再 report.query'
                : ctx.tableLoading
                    ? '报表查询进行中：等加载完成再取数'
                    : null;
            return {
                view: ctx.view,
                title: '生产看板 > 常规报表',
                mode: 'list',
                guide: GUIDE,
                actions: [
                    {
                        id: 'reports.find',
                        label: '查找报表',
                        group: 'filter',
                        returns: 'result',
                        params: [{
                            name: 'keyword',
                            type: 'text',
                            hint: '按报表名或目录名模糊匹配（不区分大小写）；不传返回前 30 条',
                        }],
                    },
                    {
                        id: 'report.options',
                        label: '取条件候选值',
                        group: 'filter',
                        returns: 'result',
                        params: [
                            {name: 'reportId', type: 'text', required: true, hint: '来自 reports.find'},
                            {
                                name: 'field',
                                type: 'text',
                                required: true,
                                hint: '条件 id，见 reports.find 的 args[].field'
                            },
                            {name: 'match', type: 'text', hint: '按候选值模糊过滤（不区分大小写）'},
                        ],
                    },
                    {
                        id: 'report.query',
                        label: '查询报表（需用户确认）',
                        group: 'toolbar',
                        waitConfirm: true,
                        disabled: ctx.confirming,
                        disabledReason: ctx.confirming
                            ? '查询确认框已弹出：等用户确认或取消，终态看 action.outcome 事件'
                            : undefined,
                        params: [
                            {
                                name: 'reportId',
                                type: 'text',
                                required: true,
                                hint: '来自 reports.find；先与用户确认是这张报表再提交',
                            },
                            {
                                name: 'values',
                                type: 'object',
                                hint: '{字段id或条件名: 值}（也接受 JSON 字符串），一次传齐；' +
                                    '未传的条件用报表默认值，空串 = 清空；日期 YYYY-MM-DD，组织填 ID 或工厂名',
                            },
                        ],
                    },
                    ...tableBridge.actions(),
                ],
                query: currentQuery(ctx),
                tables: [tableBridge.data({unreadableReason: unreadable})],
            };
        },
        handlers,
        events: [
            {
                id: 'action.outcome',
                label: '查询确认结果',
                delivery: 'immediate',
                waitConfirmFor: ['report.query'],
                // 查询确认必须等用户终态才能继续：没开界面联动也自动上报这一条终态
                autoFollow: true,
                mergeBy: ['actionId'],
                payload: [
                    {name: 'actionId', type: 'text', required: true},
                    {name: 'outcome', type: 'text', required: true},
                    {name: 'message', type: 'text'},
                ],
                hint: '只在 agent 发起 report.query 后，用户在确认框上确认或取消时立即上报；未开启界面联动也会自动送达',
            },
        ],
    };
}
