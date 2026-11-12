import type {ProductionMonitorOrderChangeReq, ProductionMonitorQueryReq} from '@/api/modules/mis';
import type {ProductionMonitorOrder, ProductionMonitorOrderList} from '@/api/schemas/mis/productionMonitorOrder';
import {
    DATETIME_FORMAT,
    formatDate,
    formatDateTime,
    isBlank,
    now,
    toDayjs,
    toNumberOrNull,
    toNumberOrZero,
    toStringOrEmpty,
} from '@/utils';

export type OrderInfoRow = ProductionMonitorOrderList & {
    FlagString: string;
};

export type OrderInfoQuery = {
    startDate: string;
    endDate: string;
    orderCode: string;
    machineCode: string;
};

export type OrderInfoQueryResult = {
    ok: boolean;
    message: string;
    total: number;
};

export type OrderInfoSaveResult = {
    ok: boolean;
    message: string;
};

export const EDITABLE_FIELDS = ['Cycle', 'StLot', 'DateStartShift', 'ShiftName', 'MachCode'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const MO_LINKED_FIELDS = [
    'OrderCode',
    'OrderDescription',
    'OrderRecusl',
    'StColor',
    'StSize',
    'StyleCode',
] as const;

export const EDITABLE_FIELD_LABELS: Record<EditableField, string> = {
    Cycle: '下机时间',
    StLot: '派工单号',
    DateStartShift: '开始时间',
    ShiftName: '班次',
    MachCode: '机台号',
};

export function isEditableField(field: string): field is EditableField {
    return (EDITABLE_FIELDS as readonly string[]).includes(field);
}

export function isMoLinkedField(field: string): boolean {
    return (MO_LINKED_FIELDS as readonly string[]).includes(field);
}

export function rowIdFromRecord(record: Record<string, unknown> | undefined | null): number | null {
    const id = toNumberOrNull(record?.ID);
    return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

export function withFlagString(row: ProductionMonitorOrderList): OrderInfoRow {
    return {...row, FlagString: row.Flag === 1 ? '审核' : ''};
}

export function copyOrderRow(source: OrderInfoRow, newId: number): OrderInfoRow {
    return withFlagString({
        ...source,
        ID: newId,
        Reason: 999,
        Flag: 0,
        IsEdit: 0,
        ChkBy: '',
        ChkDate: null,
    });
}

export function moPatch(mo: ProductionMonitorOrder | null): Pick<
    OrderInfoRow,
    'OrderCode' | 'OrderDescription' | 'OrderRecusl' | 'StColor' | 'StSize' | 'StyleCode'
> {
    return {
        OrderCode: mo?.OrderCode ?? '',
        OrderDescription: mo?.OrderDescription ?? '',
        OrderRecusl: mo?.OrderRecusl ?? '',
        StColor: mo?.StColor ?? '',
        StSize: mo?.StSize ?? '',
        StyleCode: mo?.StyleCode ?? '',
    };
}

export function editLockReason(
    row: OrderInfoRow | undefined | null,
    field: string,
    shiftReady: boolean,
): string | null {
    if (!row) return '没有选中行';
    if (!isEditableField(field)) return '该字段不可修改';
    if (row.Flag === 1) return '已审核的记录不能修改';
    if (row.Reason !== 999 && (field === 'DateStartShift' || field === 'ShiftName' || field === 'MachCode')) {
        return '仅原因为 999 的新增记录可修改开始时间、班次与机台号';
    }
    if (field === 'ShiftName' && !shiftReady) {
        return '当天班次尚未加载，请先修改开始时间或稍后重试';
    }
    return null;
}

export function validateCycle(value: unknown): string | undefined {
    const number = toNumberOrNull(value);
    if (number === null || !Number.isFinite(number)) return '下机时间必须是数字';
    return undefined;
}

export function validateMachCode(value: unknown): string | undefined {
    const number = toNumberOrNull(value);
    if (number === null || !Number.isInteger(number)) return '机台号必须是整数';
    return undefined;
}

export function validateEditableValue(field: string, value: unknown): string | undefined {
    if (field === 'Cycle') return validateCycle(value);
    if (field === 'MachCode') return validateMachCode(value);
    if (field === 'DateStartShift') return toDayjs(value) ? undefined : '开始时间不是有效日期';
    if (!isEditableField(field)) return '该字段不可修改';
    return undefined;
}

export function validateSaveRows(rows: OrderInfoRow[]): string[] {
    const issues: string[] = [];
    rows.forEach((row) => {
        const id = rowIdFromRecord(row);
        const label = id === null ? '未知 ID' : `ID ${id}`;
        if (id === null) issues.push(`${label}：缺少有效主键`);
        if (row.Flag === 1) issues.push(`${label}：已审核的记录不能保存修改`);
        const cycleIssue = validateCycle(row.Cycle);
        if (cycleIssue) issues.push(`${label}：${cycleIssue}`);
        if (row.Reason === 999) {
            const machIssue = validateMachCode(row.MachCode);
            if (machIssue) issues.push(`${label}：${machIssue}`);
            if (!toDayjs(row.DateStartShift)) issues.push(`${label}：开始时间不能为空`);
        }
    });
    return issues;
}

export function toSavePayload(row: OrderInfoRow): ProductionMonitorOrderChangeReq {
    const payload: ProductionMonitorOrderChangeReq = {
        Cycle: toNumberOrZero(row.Cycle),
        Mo: toStringOrEmpty(row.StLot).trim(),
        Fmid: toNumberOrZero(row.ID),
    };
    if (row.Reason === 999) {
        payload.DateStartShift = formatDateTime(row.DateStartShift);
        payload.GroupCode = toStringOrEmpty(row.GroupCode2);
        payload.MachCode = toNumberOrZero(row.MachCode);
    }
    return payload;
}

export function createDefaultQuery(): OrderInfoQuery {
    const today = now();
    return {
        startDate: formatDate(today.add(-1, 'day')),
        endDate: formatDate(today),
        orderCode: '',
        machineCode: '',
    };
}

export function validateQuery(query: OrderInfoQuery): string | null {
    const start = toDayjs(query.startDate);
    const end = toDayjs(query.endDate);
    if (!start) return '开始日期不是有效日期';
    if (!end) return '结束日期不是有效日期';
    if (end.isBefore(start, 'day')) return '结束日期不能早于开始日期';
    return null;
}

export function queryToReq(query: OrderInfoQuery): ProductionMonitorQueryReq {
    return {
        StartDate: query.startDate,
        EndDate: query.endDate,
        OrderCode: query.orderCode.trim(),
        MachineCode: query.machineCode.trim(),
    };
}

export function shiftDateKey(value: unknown): string {
    return formatDate(value);
}

export function sameShiftStart(a: unknown, b: unknown): boolean {
    const left = formatDateTime(a);
    const right = formatDateTime(b);
    return left !== '' && left === right;
}

export function normalizeShiftStart(value: unknown): string {
    return toDayjs(value)?.format(DATETIME_FORMAT) ?? '';
}

export function isBlankStLot(value: unknown): boolean {
    return isBlank(toStringOrEmpty(value).trim());
}
