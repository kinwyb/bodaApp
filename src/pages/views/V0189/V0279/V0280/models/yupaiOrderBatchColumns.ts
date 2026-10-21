import type {ColumnsDefine} from '@visactor/vtable';
import {buildColumns, type AppColumnDef} from '@/components/grid-table/columnBuilder';
import {registerAntdDatePickerEditor, registerAntdNumberEditor} from '@/components/grid-table/editors/register';
import {DATE_FORMAT, formatDate, toDayjs, toNumberOrNull, toStringOrEmpty} from '@/utils';

/**
 * 预订单分批弹窗的一行。
 *
 * 日期 `BatchDate` 在表格里**始终是 `YYYY-MM-DD`**：
 * - 按日期：就是用户选的那一天；
 * - 按月：统一存该月 1 日 —— 后端 `Batchs[].BatchDate` 本来就是日期，
 *   「按月」只是把输入粒度限制到月的交互，不是另一种存储格式。
 * 两种模式共用一个字段，保存时不必再分叉（见 toBatchPayload）。
 *
 * 比例 `BatchPercent` 是**百分数**（30 表示 30%），不是后端的小数（0.3）：
 * 用户填的就是百分数，换算只在读入（buildBatchRows）和提交（toBatchPayload）两个边界做一次。
 * 如果这里直接存 0.3，用户在单元格里输入 0.3 会变成 0.3%，很难解释。
 */
export interface YupaiOrderBatchRow {
    /** 行主键（表格 rowKey，也是增删行、定位错误的依据） */
    _id: string;
    /** 出货日期 / 分期月份对应的日期，空串表示未选 */
    BatchDate: string;
    /** 出货比例（百分数 0~100，空为 null） */
    BatchPercent: number | null;
    /**
     * 索引签名：`GridTable` 的 records 是 `Record<string, unknown>[]`，
     * 行模型不带它就不满足约束（详情行模型同理）。
     */
    [key: string]: unknown;
}

/**
 * 未落库行的临时主键。
 *
 * 必须唯一：GridTable 拿它当 rowKey（重复会串行），页面也靠它定位「改的是哪一行」。
 * 用模块级自增而不是行号 —— 删行 / 插行后行号全变，主键不变。
 */
let batchRowSeq = 0;
const nextBatchRowKey = (): string => {
    batchRowSeq += 1;
    return `batch-${batchRowSeq}`;
};

/** 新建一行空白分批 */
export function createBatchRow(): YupaiOrderBatchRow {
    return {_id: nextBatchRowKey(), BatchDate: '', BatchPercent: null};
}

/** 整行是否没填东西（判断「这行要不要提交」「末尾要不要补空行」） */
export function isBatchRowEmpty(row: YupaiOrderBatchRow): boolean {
    return toStringOrEmpty(row.BatchDate) === '' && toNumberOrNull(row.BatchPercent) === null;
}

/**
 * 单行是否**通过校验**：日期已选 + 比例是 1~100。
 *
 * 这就是「要不要在下面给一行空白」的判据（合计是跨行的另一条，见 rebuildBatchTail）：
 * 一行只填了半边（有月份没比例、或者反过来）时不给新行 —— 用户该先把这一行补完，
 * 否则很容易一路回车造出一堆半截数据。
 */
export function isBatchRowValid(row: YupaiOrderBatchRow): boolean {
    if (toStringOrEmpty(row.BatchDate) === '') return false;
    const percent = toNumberOrNull(row.BatchPercent);
    return percent !== null && percent > 0 && percent <= 100;
}

/** 有效行的比例合计（百分数，保留两位规避浮点尾巴） */
export function sumBatchPercent(rows: YupaiOrderBatchRow[]): number {
    const total = rows.reduce((sum, row) => sum + (toNumberOrNull(row.BatchPercent) ?? 0), 0);
    return Math.round(total * 100) / 100;
}

/**
 * 后端小数比例 → 界面百分数。
 *
 * 先乘 100 再四舍五入到两位小数：0.1 * 100 在浮点里是 10.000000000000002，
 * 直接显示/参与合计会带一堆尾巴。
 */
function toBatchPercent(rate: unknown): number | null {
    const value = toNumberOrNull(rate);
    if (value === null) return null;
    return Math.round(value * 10000) / 100;
}

/**
 * 重建表格末尾的空白行 —— 空白行只在「上一行通过校验、且合计还没到 100」时才存在。
 *
 * 规则（业务要求）：
 * - 末尾**最多一行**空白；上一行没填完整就不给（先补完再说）；
 * - 合计 **>= 100** 时不再给新行 —— 比例已经占满，再加一行必然超 100；
 * - 一条数据都没有时给一行空白，保证打开就能填。
 *
 * 实现上先摘掉末尾已有的空白行、需要时**原样放回同一个对象**（而不是新建）：
 * 换新主键会让 GridTable 认为整行变了 —— 编辑中间某行时，末尾那行的 rowKey 一抖动，
 * 整个表格重建，正在编辑的单元格会被打断。
 */
export function rebuildBatchTail(rows: YupaiOrderBatchRow[]): YupaiOrderBatchRow[] {
    const body = [...rows];
    /** 末尾原有的空白行（可能不止一行，理论上只会有一行），复用它以免换主键 */
    let trailingBlank: YupaiOrderBatchRow | null = null;
    while (body.length > 0 && isBatchRowEmpty(body[body.length - 1])) {
        trailingBlank = trailingBlank ?? body[body.length - 1];
        body.pop();
    }
    // 一行数据都没有：复用原空白行（没有就新建）
    if (body.length === 0) return [trailingBlank ?? createBatchRow()];

    const last = body[body.length - 1];
    if (isBatchRowValid(last) && sumBatchPercent(body) < 100) {
        body.push(trailingBlank ?? createBatchRow());
    }
    return body;
}

/**
 * 订单上的分批发数据 → 弹窗行。
 *
 * 末尾的空白行由 rebuildBatchTail 决定：合计已经 100 的单子打开时就没有空白行，
 * 免得用户以为还能再加一批。
 */
export function buildBatchRows(batchs: unknown): YupaiOrderBatchRow[] {
    const list = Array.isArray(batchs) ? (batchs as Array<Record<string, unknown>>) : [];
    const rows: YupaiOrderBatchRow[] = list.map((item) => ({
        _id: nextBatchRowKey(),
        // 后端可能是 '2026-11-01' 或 '2026-11-01T00:00:00'，统一取到日
        BatchDate: formatDate(item.BatchDate),
        BatchPercent: toBatchPercent(item.BatchRate),
    }));
    return rebuildBatchTail(rows);
}

/**
 * 打开弹窗时默认用哪种粒度。
 *
 * 截图里空表默认「按月」；但如果已有分批数据带具体日期（不是月初），
 * 直接按月打开会把日期显示成月份，保存后日期被截到月初 —— 等于悄悄改坏了原数据。
 * 所以只有「没有数据」或「数据全都落在月初」时才按月，否则按日期。
 */
export function shouldDefaultByDate(batchs: unknown): boolean {
    const list = Array.isArray(batchs) ? (batchs as Array<Record<string, unknown>>) : [];
    return list.some((item) => {
        const date = toDayjs(item.BatchDate);
        return date ? date.date() !== 1 : false;
    });
}

/** 切换「按日期 / 按月」时把已有行的日期归一到对应粒度（空的保持空） */
export function normalizeBatchDate(value: string, byDate: boolean): string {
    const date = toDayjs(value);
    if (!date) return '';
    return (byDate ? date : date.startOf('month')).format(DATE_FORMAT);
}

// ─── 编辑器：字段 → 控件（每个字段/模式各占一个具名实例） ─────────────────────
//
// @visactor/vtable 的编辑器注册表是全局的，**同名幂等、先注册者生效**：
// 「按月」与「按日期」是两种控件配置，必须各注册一个名字，不能共用一个。
const BATCH_MONTH_EDITOR = 'preorder-batch-month';
const BATCH_DATE_EDITOR = 'preorder-batch-date';
const BATCH_PERCENT_EDITOR = 'preorder-batch-percent';

registerAntdDatePickerEditor(
    BATCH_MONTH_EDITOR,
    {
        picker: 'month',
        // 月面板选出来的 dayjs 就是当月 1 日，按日期格式写回，与「按月存月初」的约定一致
        valueFormat: DATE_FORMAT,
        placeholder: '选择月份',
    },
    {
        validator: (value) =>
            toStringOrEmpty(value) ? undefined : '请选择分期月份',
    },
);

registerAntdDatePickerEditor(
    BATCH_DATE_EDITOR,
    {
        format: DATE_FORMAT,
        valueFormat: DATE_FORMAT,
        placeholder: '选择日期',
    },
    {
        validator: (value) =>
            toStringOrEmpty(value) ? undefined : '请选择出货日期',
    },
);

registerAntdNumberEditor(
    BATCH_PERCENT_EDITOR,
    // 不设 precision：用户填 10 就显示 10（截图里是老系统的整数输入框），
    // 填两位小数也照常保留，合计与提交时的换算都按实际值算
    {min: 0, max: 100, style: {width: '100%'}},
    {
        // 单格校验只判本格（合计、重复月份是跨行规则，放在弹窗点「确定」时统一校验）
        validator: (value) => {
            const percent = toNumberOrNull(value);
            if (percent === null) return '请填写出货比例';
            if (percent <= 0) return '出货比例必须大于 0';
            if (percent > 100) return '出货比例不能超过 100';
            return undefined;
        },
    },
);

/** 字段 → 编辑器名：随着「按日期」切换，日期列换成另一种控件 */
export function batchEditableFields(byDate: boolean): Record<string, string> {
    return {
        BatchDate: byDate ? BATCH_DATE_EDITOR : BATCH_MONTH_EDITOR,
        BatchPercent: BATCH_PERCENT_EDITOR,
    };
}

/**
 * 分批表格的列定义（只描述展示，编辑器由 editableFields 注入）。
 *
 * 日期列不用 `dataType: 'date'`：单元格里存的始终是完整日期，
 * 按月模式只该显示到月 —— 交给 fieldFormat 按当前粒度裁剪，两种模式共用一份数据。
 */
export function buildBatchColumns(byDate: boolean): ColumnsDefine {
    const columns: AppColumnDef[] = [
        {
            field: 'BatchDate',
            title: byDate ? '出货日期' : '分期月份',
            width: 220,
            fieldFormat: (record: Record<string, unknown>) => {
                const date = toDayjs(record.BatchDate);
                if (!date) return '';
                return date.format(byDate ? DATE_FORMAT : 'YYYY-MM');
            },
        },
        {
            field: 'BatchPercent',
            title: '出货比例',
            width: 220,
            dataType: 'double',
            fieldFormat: (record: Record<string, unknown>) => {
                const percent = toNumberOrNull(record.BatchPercent);
                // 空行显示空白，别显示 0（0 在这里是「没填」，不是「0%」）
                return percent === null ? '' : String(percent);
            },
        },
    ];
    return buildColumns(columns);
}
