import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {type BonusBridgeContext, createBonusBridge} from '../bonusBridge';

export function createVnMechanicBonusBridge(read: () => BonusBridgeContext): UIBridgeHost {
    return createBonusBridge(read, {
        summary: '织造机修绩效统计(越南)：按月查看机修工奖金汇总，选中员工后查看该员工的每日明细',
        steps: [
            '数据有两张表：summary = 月汇总，detail = 明细；定位表必须用 name 字段',
            '换月份用 query.set，格式 YYYY-MM',
            '选中月汇总员工后，detail 会自动只显示该员工；双击任一行可打开机台效率明细',
        ],
        cautions: ['主表与明细表都有奖金列，但导出只导出 detail 明细表。'],
    });
}
