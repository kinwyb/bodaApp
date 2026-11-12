import type {MisScheduleEmployee, ScheduleBJ, ScheduleUpdateReq} from '@/api';
import {isBlank, toNumberOrZero, toStringOrEmpty} from '@/utils';

export const EMPLOYEE_FIELDS = ['OpeCode', 'OpeCode2', 'OpeCode3', 'OpeCode4'] as const;

export type EmployeeField = typeof EMPLOYEE_FIELDS[number];

export type ScheduleQuery = {
    date: string;
};

export type ScheduleQueryResult = {
    ok: boolean;
    message: string;
    total: number;
};

export type ScheduleMutationResult = {
    ok: boolean;
    message: string;
};

export type EmployeeDirectory = Partial<Record<number, MisScheduleEmployee[]>>;

export type MachineScheduleRow = {
    MachCode: number;
    Shift1: string;
    Shift1Name: string;
    Shift2: string;
    Shift2Name: string;
    Shift3: string;
    Shift3Name: string;
    PlantCode: string;
};

export const EMPLOYEE_FIELD_META: Record<EmployeeField, {
    label: string;
    nameField: 'OpeName' | 'OpeName2' | 'OpeName3' | 'OpeName4';
    group: number;
}> = {
    OpeCode: {label: '挡车工编号', nameField: 'OpeName', group: 0},
    OpeCode2: {label: '踩毛边工编号', nameField: 'OpeName2', group: 2},
    OpeCode3: {label: '毛坯全检工编号', nameField: 'OpeName3', group: 3},
    OpeCode4: {label: '机修工编号', nameField: 'OpeName4', group: 4},
};

export const EMPLOYEE_GROUPS = [...new Set(
    EMPLOYEE_FIELDS.map((field) => EMPLOYEE_FIELD_META[field].group),
)];

export function isEmployeeField(field: string): field is EmployeeField {
    return (EMPLOYEE_FIELDS as readonly string[]).includes(field);
}

export function findScheduleEmployee(
    directory: EmployeeDirectory,
    field: EmployeeField,
    code: unknown,
): MisScheduleEmployee | undefined {
    const value = toStringOrEmpty(code).trim();
    if (!value) return undefined;
    return (directory[EMPLOYEE_FIELD_META[field].group] ?? [])
        .find((employee) => toStringOrEmpty(employee.No).trim() === value);
}

export function employeeCodes(
    directory: EmployeeDirectory,
    field: EmployeeField,
): string[] {
    return [...new Set(
        (directory[EMPLOYEE_FIELD_META[field].group] ?? [])
            .map((employee) => toStringOrEmpty(employee.No).trim())
            .filter(Boolean),
    )];
}

export function employeeOptions(
    directory: EmployeeDirectory,
    field: EmployeeField,
): Array<{value: string; label: string; data: MisScheduleEmployee}> {
    return (directory[EMPLOYEE_FIELD_META[field].group] ?? [])
        .map((employee) => {
            const value = toStringOrEmpty(employee.No).trim();
            if (!value) return null;
            const name = toStringOrEmpty(employee.Name).trim();
            return {
                value,
                label: name ? `${value} ${name}` : value,
                data: employee,
            };
        })
        .filter((option): option is {value: string; label: string; data: MisScheduleEmployee} => option !== null);
}

export function applyEmployeeCode(
    row: ScheduleBJ,
    field: EmployeeField,
    code: unknown,
    directory: EmployeeDirectory,
): ScheduleBJ {
    const value = toStringOrEmpty(code).trim();
    const employee = findScheduleEmployee(directory, field, value);
    const meta = EMPLOYEE_FIELD_META[field];
    const next: ScheduleBJ = {
        ...row,
        [field]: value,
        [meta.nameField]: employee ? toStringOrEmpty(employee.Name) : '',
    };
    if (field === 'OpeCode') {
        next.GroupCode = employee ? toStringOrEmpty(employee.GroupCode) : '';
    }
    return next;
}

export function toScheduleUpdateReq(row: ScheduleBJ): ScheduleUpdateReq {
    return {
        ID: toNumberOrZero(row.ID),
        GroupCode: toStringOrEmpty(row.GroupCode),
        OpeCode: toStringOrEmpty(row.OpeCode),
        OpeCode2: toStringOrEmpty(row.OpeCode2),
        OpeCode3: toStringOrEmpty(row.OpeCode3),
        OpeCode4: toStringOrEmpty(row.OpeCode4),
    };
}

function emptyMachineSchedule(machCode: number): MachineScheduleRow {
    return {
        MachCode: machCode,
        Shift1: '',
        Shift1Name: '',
        Shift2: '',
        Shift2Name: '',
        Shift3: '',
        Shift3Name: '',
        PlantCode: '',
    };
}

/**
 * 旧客户端把每个班次记录汇总成 TileView 的一台机台。
 * 班次归并规则严格照 V0122.SetScheduleBJ。
 */
export function groupMachineSchedules(rows: ScheduleBJ[]): MachineScheduleRow[] {
    const machines = new Map<number, MachineScheduleRow>();
    rows.forEach((row) => {
        const machCode = toNumberOrZero(row.MachineID);
        const machine = machines.get(machCode) ?? emptyMachineSchedule(machCode);
        const shift = toStringOrEmpty(row.Shift);
        const opeName = toStringOrEmpty(row.OpeName);
        if (shift === '交班1' || shift === '白班') {
            machine.Shift1 = shift;
            machine.Shift1Name = opeName;
        } else if (shift === '交班2') {
            machine.Shift2 = shift;
            machine.Shift2Name = opeName;
        } else if (shift === '夜班') {
            machine.Shift3 = shift;
            machine.Shift3Name = opeName;
        }
        if (isBlank(machine.PlantCode)) {
            machine.PlantCode = toStringOrEmpty(row.PlantCode);
        }
        machines.set(machCode, machine);
    });
    return [...machines.values()].sort((left, right) => left.MachCode - right.MachCode);
}
