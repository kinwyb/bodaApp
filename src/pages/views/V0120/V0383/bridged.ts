import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createEfficiencyBridge, type EfficiencyBridgeContext} from '../efficiencyBridge';

export function createSpinnerEfficiencyBridge(read: () => EfficiencyBridgeContext): UIBridgeHost {
    return createEfficiencyBridge(read, {
        summary: '织造挡车效率：按日期范围查询越南挡车工的产量效率动态报表',
        steps: [
            '列由存储过程返回，可能随字段调整变化；先看 tables[].columns 再取数',
            '换日期范围用 query.set，日期格式 YYYY-MM-DD',
            '数值列底部统计行为求和',
        ],
        cautions: ['该报表只适用于越南组织数据。'],
    });
}
