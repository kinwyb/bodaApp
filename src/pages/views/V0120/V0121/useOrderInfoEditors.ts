import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {misMachineApi, misProductionMonitorApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import type {ProductionMonitorOrder} from '@/api/schemas/mis/productionMonitorOrder';
import type {ShiftInfo} from '@/api/schemas/mis/machineShift';
import type {GridTableCanEditCellHook, GridTableCellTooltipHook} from '@/components/grid-table';
import {
    registerAntdDatePickerEditor,
    registerAntdInputEditor,
    registerAntdNumberEditor,
    registerAntdSelectEditor,
} from '@/components/grid-table/editors/register';
import {DATETIME_FORMAT, formatDate, formatDateTime, isBlank, toDayjs, toStringOrEmpty} from '@/utils';
import {
    editLockReason,
    isEditableField,
    moPatch,
    rowIdFromRecord,
    shiftDateKey,
    validateCycle,
    validateMachCode,
    type OrderInfoRow,
} from './orderInfo';

type UseOrderInfoEditorsOptions = {
    isEditing: () => boolean;
    applyPatch: (id: number, patch: Partial<OrderInfoRow>) => void;
    fillDownStLot: (sourceId: number, stLot: string) => void;
};

export type OrderInfoEditors = {
    shiftVersion: number;
    editableFieldsFor: (row: OrderInfoRow | null) => Record<string, string | true> | undefined;
    canEditCell: GridTableCanEditCellHook;
    cellTooltip: GridTableCellTooltipHook;
    prefetchShifts: (date: string) => void;
    loadShifts: (date: string) => Promise<ShiftInfo[]>;
    isShiftReady: (date: unknown) => boolean;
    shiftOptions: (date: unknown) => string[];
    resolveMo: (mo: string) => Promise<ProductionMonitorOrder | null>;
};

/**
 * 页面私有编辑器。班次候选按日期注册成具名 Select，避免把异步请求塞进 canEditCell；
 * 派工单回填与回车向下填充都锚定数字 ID，不依赖排序后的行号。
 */
export function useOrderInfoEditors(options: UseOrderInfoEditorsOptions): OrderInfoEditors {
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
    const names = useMemo(() => ({
        cycle: `v0121-${instanceId}-cycle`,
        machCode: `v0121-${instanceId}-mach`,
        stLot: `v0121-${instanceId}-stlot`,
        dateStartShift: `v0121-${instanceId}-start`,
        shiftPrefix: `v0121-${instanceId}-shift-`,
    }), [instanceId]);

    const [shiftVersion, setShiftVersion] = useState(0);
    const mountedRef = useRef(true);
    const shiftCacheRef = useRef(new Map<string, ShiftInfo[]>());
    const shiftLoadingRef = useRef(new Map<string, Promise<ShiftInfo[]>>());
    const shiftErrorRef = useRef(new Map<string, string>());
    const shiftEditorsRef = useRef(new Set<string>());
    const moCacheRef = useRef(new Map<string, ProductionMonitorOrder | null>());
    const moLoadingRef = useRef(new Map<string, Promise<ProductionMonitorOrder | null>>());
    const stLotEnterRef = useRef(false);
    const stLotCommitRef = useRef<{id: number; value: string} | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const registerShiftEditor = useCallback((date: string, shifts: ShiftInfo[]) => {
        const name = `${names.shiftPrefix}${date}`;
        if (shiftEditorsRef.current.has(name)) return;
        shiftEditorsRef.current.add(name);
        registerAntdSelectEditor(name, {
            options: shifts.map((shift) => ({
                value: toStringOrEmpty(shift.Name),
                label: toStringOrEmpty(shift.Name),
                data: shift,
            })),
        }, {
            onCommit: ({option}, row) => {
                const shift = option?.data as ShiftInfo | undefined;
                const start = formatDateTime(shift?.StartTime);
                if (!shift || !start) return;
                row.setFields({DateStartShift: start});
            },
        });
    }, [names.shiftPrefix]);

    const resolveMo = useCallback(async (mo: string): Promise<ProductionMonitorOrder | null> => {
        const key = mo.trim();
        if (moCacheRef.current.has(key)) return moCacheRef.current.get(key) ?? null;
        const loading = moLoadingRef.current.get(key);
        if (loading) return loading;

        const pending = (async () => {
            if (!key) {
                moCacheRef.current.set(key, null);
                return null;
            }
            const result = await misProductionMonitorApi.moInfo(key);
            const data = result.data ?? null;
            moCacheRef.current.set(key, data);
            return data;
        })().finally(() => {
            moLoadingRef.current.delete(key);
        });
        moLoadingRef.current.set(key, pending);
        return pending;
    }, []);

    const loadShifts = useCallback(async (date: string): Promise<ShiftInfo[]> => {
        const key = shiftDateKey(date);
        if (!key) throw new Error('开始时间无效，无法加载班次');
        const cached = shiftCacheRef.current.get(key);
        if (cached) return cached;
        const loading = shiftLoadingRef.current.get(key);
        if (loading) return loading;

        const pending = (async () => {
            const result = await misMachineApi.machineShift(key);
            const shifts = (result.data ?? []).filter((shift) =>
                !isBlank(shift.Name) && toDayjs(shift.StartTime) !== undefined,
            );
            shiftCacheRef.current.set(key, shifts);
            shiftErrorRef.current.delete(key);
            registerShiftEditor(key, shifts);
            if (mountedRef.current) setShiftVersion((version) => version + 1);
            return shifts;
        })().catch((error: unknown) => {
            const message = ErrorMessage(error, '班次信息加载失败');
            shiftErrorRef.current.set(key, message);
            if (mountedRef.current) setShiftVersion((version) => version + 1);
            throw error;
        }).finally(() => {
            shiftLoadingRef.current.delete(key);
        });
        shiftLoadingRef.current.set(key, pending);
        return pending;
    }, [registerShiftEditor]);

    const prefetchShifts = useCallback((date: string) => {
        const key = shiftDateKey(date);
        if (!key || shiftCacheRef.current.has(key) || shiftLoadingRef.current.has(key)) return;
        void loadShifts(key).catch(() => {
            // 选中行时静默预取；真正要编辑班次时由锁提示/写入回执说明失败原因。
        });
    }, [loadShifts]);

    const isShiftReady = useCallback((date: unknown) => {
        return shiftCacheRef.current.has(shiftDateKey(date));
    }, []);

    const shiftOptions = useCallback((date: unknown) => {
        return (shiftCacheRef.current.get(shiftDateKey(date)) ?? [])
            .map((shift) => toStringOrEmpty(shift.Name))
            .filter(Boolean);
    }, []);

    useEffect(() => {
        registerAntdNumberEditor(names.cycle, {step: 0.01}, {
            validator: (value) => validateCycle(value),
        });
        registerAntdNumberEditor(names.machCode, {precision: 0, step: 1}, {
            validator: (value) => validateMachCode(value),
        });
        registerAntdDatePickerEditor(names.dateStartShift, {
            showTime: true,
            format: DATETIME_FORMAT,
            valueFormat: DATETIME_FORMAT,
        }, {
            validator: (value) => (toDayjs(value) ? undefined : '请选择开始时间'),
            onCommit: ({value}) => {
                const date = formatDate(value);
                if (date) prefetchShifts(date);
            },
        });
        registerAntdInputEditor(names.stLot, {
            onKeyDownCapture: (event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    stLotEnterRef.current = true;
                }
            },
        }, {
            validator: async (value) => {
                try {
                    await resolveMo(toStringOrEmpty(value).trim());
                    return undefined;
                } catch (error) {
                    return ErrorMessage(error, '派工单资料加载失败');
                }
            },
            onStart: () => {
                stLotEnterRef.current = false;
                stLotCommitRef.current = null;
            },
            onCommit: ({value, previousValue}, row) => {
                const id = rowIdFromRecord(row.record);
                if (id === null) return;
                const text = toStringOrEmpty(value).trim();
                if (text === toStringOrEmpty(previousValue).trim()) return;
                const mo = moCacheRef.current.get(text) ?? null;
                row.setFields(moPatch(mo));
                stLotCommitRef.current = {id, value: text};
            },
            onEnd: () => {
                const commit = stLotCommitRef.current;
                const enter = stLotEnterRef.current;
                stLotEnterRef.current = false;
                stLotCommitRef.current = null;
                if (enter && commit) {
                    queueMicrotask(() => optionsRef.current.fillDownStLot(commit.id, commit.value));
                }
            },
        });
    }, [names, prefetchShifts, resolveMo]);

    const editableFieldsFor = useCallback((row: OrderInfoRow | null) => {
        if (!optionsRef.current.isEditing()) return undefined;
        const fields: Record<string, string | true> = {
            Cycle: names.cycle,
            StLot: names.stLot,
            DateStartShift: names.dateStartShift,
            MachCode: names.machCode,
        };
        if (row && row.Flag !== 1 && row.Reason === 999 && isShiftReady(row.DateStartShift)) {
            fields.ShiftName = `${names.shiftPrefix}${shiftDateKey(row.DateStartShift)}`;
        }
        return fields;
    }, [isShiftReady, names]);

    const canEditCell = useCallback<GridTableCanEditCellHook>((info) => {
        if (!optionsRef.current.isEditing() || !isEditableField(info.field)) return false;
        const row = info.record as OrderInfoRow | undefined;
        const shiftReady = info.field === 'ShiftName' ? isShiftReady(row?.DateStartShift) : true;
        return editLockReason(row, info.field, shiftReady) === null;
    }, [isShiftReady]);

    const cellTooltip = useCallback<GridTableCellTooltipHook>((info) => {
        if (!isEditableField(info.field)) return undefined;
        if (!optionsRef.current.isEditing()) return '点击「编辑」后才能修改';
        const row = info.record as OrderInfoRow | undefined;
        const shiftReady = info.field === 'ShiftName' ? isShiftReady(row?.DateStartShift) : true;
        const reason = editLockReason(row, info.field, shiftReady);
        if (reason) return reason;
        if (info.field === 'ShiftName' && shiftErrorRef.current.has(shiftDateKey(row?.DateStartShift))) {
            return shiftErrorRef.current.get(shiftDateKey(row?.DateStartShift));
        }
        return undefined;
    }, [isShiftReady]);

    return useMemo(() => ({
        shiftVersion,
        editableFieldsFor,
        canEditCell,
        cellTooltip,
        prefetchShifts,
        loadShifts,
        isShiftReady,
        shiftOptions,
        resolveMo,
    }), [
        shiftVersion,
        editableFieldsFor,
        canEditCell,
        cellTooltip,
        prefetchShifts,
        loadShifts,
        isShiftReady,
        shiftOptions,
        resolveMo,
    ]);
}
