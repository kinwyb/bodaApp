/**
 * V0332 取数：SQL 直查 transitDB 的周数据长表（DataType=2，机型维度），
 * 透视成「一周一行 × 组织+指标+尺寸 列」，同时收集各机型的机台数（表头括号里的数字）。
 * 对应旧客户端 `V0332.cs` 的 loadData + dataParse。
 */
import {sqlApi, S, N} from '@/api';
import {isBlank, toNumberOrZero} from '@/utils';
import {PRODUCTION_ORGS} from '../productionShared';
import type {MachineCounts} from './columns';

const MACHINE_WEEK_SQL =
    'SELECT * FROM [transitDB].dbo.ProductionWeekData WHERE IsDel = 0 AND DataType = 2 AND WeekYear = ? ORDER BY StartDate,ExtendVal1';

/** SQL 长表的一行（旧客户端私有类 weekData） */
type MachineWeekRecord = {
    WeekYear: number;
    WeekNum: number;
    StartDate: string;
    EndDate: string;
    DataField: string;
    DataValue: number;
    OrgID: string;
    ExtendVal1: string;
};

export type MachineWeekData = {
    rows: Array<Record<string, unknown>>;
    counts: MachineCounts;
};

export async function loadMachineWeek(year: number): Promise<MachineWeekData> {
    const result = await sqlApi.query({SQL: MACHINE_WEEK_SQL, Args: [String(year)]});
    const records = result.data?.parseToList<MachineWeekRecord>({
        WeekYear: N,
        WeekNum: N,
        StartDate: S,
        EndDate: S,
        DataField: S,
        DataValue: N,
        OrgID: S,
        ExtendVal1: S,
    }) ?? [];

    const rowsByName = new Map<string, Record<string, unknown>>();
    const counts: MachineCounts = {};
    for (const record of records) {
        if (isBlank(record.ExtendVal1)) continue;
        const weekName = `${record.WeekYear}第${String(record.WeekNum).padStart(2, '0')}周`;
        let row = rowsByName.get(weekName);
        if (!row) {
            // _rowKey 是隐藏主键（值 = 周名），避免统计行把 __summary__ 写进可见的 WeekName 列
            row = {WeekName: weekName, WeekStartDate: record.StartDate, WeekEndDate: record.EndDate, _rowKey: weekName};
            rowsByName.set(weekName, row);
        }
        const org = PRODUCTION_ORGS.find((item) => item.id === record.OrgID);
        if (!org) continue;
        const size = record.ExtendVal1.replace('寸', '');
        if (record.DataField === 'MZMachineCount') {
            // 机台数只进表头统计，不占数据列（旧客户端同样没有这一列）
            (counts[size] ??= {})[org.prefix] = Math.trunc(toNumberOrZero(record.DataValue));
            continue;
        }
        if (record.DataField !== 'MZEfficiency' && record.DataField !== 'MZUtilizationRate') continue;
        // 两个指标都是比率类：接口原值是百分数，入表除以 100
        row[org.prefix + record.DataField + size] = toNumberOrZero(record.DataValue) / 100;
    }
    return {rows: [...rowsByName.values()], counts};
}
