/**
 * 工艺路线矩阵的**行模型与转换**。
 *
 * 比包装 BOM 矩阵简单一个量级：这里只有一张可编辑表（工序明细），
 * 没有「同一批行的另外两种投影」，所以没有跨表同步、没有 `draft` 主键之外的临时字段，
 * 也没有「尺码 / 颜色」那种从 `SizeMatch` 反推出来的动态格。
 *
 * 行标识：`ProcessRouteMatrixDetailID`（明细主键，未保存的新行是 `draft-N`）。
 */

import type {
    ProcessRouteMatrixDetail,
} from '@/api/schemas/nc/processRouteMatrix.ts';
import {formatDate, now, toStringOrEmpty} from '@/utils';

/**
 * 一行工序明细。
 *
 * 明细字段打底，额外只保证 `ProcessRouteMatrixDetailID` 一定有值 —— 表格的 rowKey 用它，
 * 空串会让所有新行串成同一行（选中、按主键定位全会错）。
 */
export type ProcessRouteRow = Partial<ProcessRouteMatrixDetail> & {
    /** 行标识：明细主键 / 新行 `draft-N` */
    ProcessRouteMatrixDetailID: string;
    [key: string]: unknown;
};

/** 未落库的行主键前缀 */
export const DRAFT_ID_PREFIX = 'draft-';

/** 这一行的主键是不是界面临时造的（保存前要抹掉，后端不认识） */
export const isDraftRowKey = (rowKey: unknown): boolean =>
    toStringOrEmpty(rowKey).startsWith(DRAFT_ID_PREFIX);

/** 行标识；拿不到时是空串 */
export const rowKeyOf = (row: Record<string, unknown> | undefined): string =>
    String(row?.ProcessRouteMatrixDetailID ?? '');

/**
 * 这一行填了工序没有。
 *
 * 编辑态的表格**末尾永远留一行空行**等用户输入（见 `itemView` 的补空行逻辑），
 * 它不是明细：保存时不该提交、校验时不该报错。
 *
 * 判据取「工序编码 / 工序名称 / 工序ID 有一个就算有」：工艺行可能只有编码（手填），
 * 也可能从工序档案选进来（只带名称与 ID）。所以别只看 `CrcCode`。
 *
 * 保存装配与校验都用这一份判据 —— 各写一份的话，某天改成只看编码，
 * 另一处就会把「只选了名称的行」当空行丢掉。
 */
export const rowHasProcess = (row: Record<string, unknown> | undefined): boolean =>
    toStringOrEmpty(row?.CrcCode) !== ''
    || toStringOrEmpty(row?.CrcName) !== ''
    || toStringOrEmpty(row?.CrcID) !== '';

/**
 * 未落库的新行主键。
 *
 * 模块级自增：反复增删、上下插行都不会撞。**不要用行号** —— 行号可改、可重复。
 */
let draftRowSeq = 0;
export const nextDraftRowKey = (): string => {
    draftRowSeq += 1;
    return `${DRAFT_ID_PREFIX}${draftRowSeq}`;
};

/**
 * 新建一行工序。
 *
 * 三个消费者：进编辑时补的空行、右键「新增行」、底部的下一行。
 * 默认值放一处，免得三者各写一套（某天改默认转移方式只改到其中一处）：
 * - `ProcessMoveType: 2`（自动转移）：NC 里新建工序行的默认；
 * - `MixDeliverNum: 1`：浮余系数默认 1，不是 0（0 会让用量算成 0）；
 * - 生效日期取今天、失效日期给 `2999-12-31`（与后端长期有效的口径一致）；
 * - 时间 / 工价类一律**留空**，不填 0：0 与「还没定」在工艺上是两件事，
 *   填 0 会让人以为这道工序真的不耗时。
 */
export function createItemRow(rowNo: string): ProcessRouteRow {
    return {
        ProcessRouteMatrixDetailID: nextDraftRowKey(),
        VRowNo: rowNo,
        CrcCode: '',
        CrcName: '',
        CrcDesc: '',
        WorkStation: '',
        MainProcess: false,
        CheckPoint: false,
        CountPoint: false,
        HandOverPoint: false,
        OutProcess: false,
        AllowAdd: false,
        MixDeliverNum: 1,
        ProcessMoveType: 2,
        CraftNote: '',
        EffectDate: formatDate(now()),
        InvalidDate: '2999-12-31',
    };
}

/** 明细行 → 表格行：参与行定位 / 显示的字段统一成字符串，内容不动 */
function detailToRow(detail: ProcessRouteMatrixDetail): ProcessRouteRow {
    return {
        ...detail,
        ProcessRouteMatrixDetailID: toStringOrEmpty(detail.ProcessRouteMatrixDetailID),
        VRowNo: toStringOrEmpty(detail.VRowNo),
    };
}

/** 明细 → 表格行（这张表编辑的就是明细本身，不需要从别处拼字段） */
export function toItemRows(items: ProcessRouteMatrixDetail[]): ProcessRouteRow[] {
    return items.map(detailToRow);
}
