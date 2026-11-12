import {
    misProductionApi,
    misReportApi,
    type MisProduceDataReq,
    type MisProduceDataRow,
} from '@/api';
import {isBlank} from '@/utils';

function statusOf(row: MisProduceDataRow, isVietnam: boolean): string {
    if (isVietnam && isBlank(row.DispatchNo)) return '未扫描';
    if (row.Flag === 1) return isVietnam ? '已入库' : '已同步';
    return '';
}

/** 挡车产量数据：越南走 Nautilus 视图，其它组织走 HTTP 接口 */
export const misProductionService = {
    async appletsData(payload: MisProduceDataReq, isVietnam: boolean): Promise<MisProduceDataRow[]> {
        if (isVietnam) {
            return misReportApi.vnAppletsData(payload);
        }
        const result = await misProductionApi.appletsData(payload);
        return (result.data ?? []).map((row) => {
            const mapped = {
                ...row,
                Status: '',
            } satisfies MisProduceDataRow;
            mapped.Status = statusOf(mapped, false);
            return mapped;
        });
    },
};
