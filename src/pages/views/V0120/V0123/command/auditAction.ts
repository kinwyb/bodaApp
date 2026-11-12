import {misProductionMonitorApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {toNumberOrZero} from '@/utils';
import type {ProductionMonitorCommandContext} from './types';

export async function runProductionMonitorAudit(ctx: ProductionMonitorCommandContext): Promise<void> {
    const rows = ctx.getSelectedRows().filter((row) => toNumberOrZero(row.Flag) === 0);
    if (rows.length === 0) {
        ctx.message.info('所选数据均已审核');
        return;
    }
    const ids = rows.map((row) => toNumberOrZero(row.ID)).filter((id) => id > 0);
    if (ids.length === 0) {
        ctx.message.warning('所选数据缺少 ID，无法审核');
        return;
    }
    try {
        await misProductionMonitorApi.audit(ids.join(','), true);
        ctx.message.success('审核成功');
        await ctx.reload();
    } catch (error) {
        ctx.message.error(ErrorMessage(error, '审核失败'));
        throw error;
    }
}
