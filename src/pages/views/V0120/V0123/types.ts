import type {ProductionMonitorQueryRes} from '@/api';

export type ProductionMonitorQueryState = {
    startDate: string;
    endDate: string;
    orderCode: string;
    machineCode: string;
    roomCode: string;
};

/** ZPTime 与 Status 是旧客户端在界面层派生的字段，接口本身不返回。 */
export type ProductionMonitorRow = ProductionMonitorQueryRes & {
    ZPTime: number;
    Status: string;
};
