import {http} from '../request';
import {DataSource, type SimpleDataTable, sqlApi} from './sql';
import {isBlank, toNumberOrZero, toStringOrEmpty} from '@/utils';
import {SalaryDetailSchema, SalaryPiecesCountGroupSchema,} from '../schemas/mis/scheduleSalary';
import {
    type DateShiftDataQueryFromKnitStore,
    DateShiftDataQueryFromKnitStoreSchema,
} from '../schemas/mis/productionMonitor';

export type SalaryDetailReq = {
    EmployeeNo?: string;
    EndDate: string;
    MachineCode: string;
    OrderCode: string;
    RoomCode?: string;
    StartDate: string;
};

export type SalaryPiecesCountGroupReq = {
    DateShiftEnd: string;
    DateShiftStart: string;
    OrderCode: string;
    RoomCode?: string;
};

export type SalaryBonusMonth = {
    Month: string;
    EmployeeNo: string;
    Employee: string;
    Bonus: number;
};

export type SalaryBonusMonthDetail = {
    WorkDate: string;
    EmployeeNo: string;
    Employee: string;
    Qty: number;
    Bonus: number;
};

export type SalaryBonusMachRate = {
    WorkDate: string;
    EmployeeNo: string;
    Employee: string;
    MachCode: number;
    Rate: number;
    Bonus: number;
    Qty: number;
};

export type MisProduceDataReq = {
    StartTime: string;
    EndTime: string;
    MachCode?: number;
};

export type MisProduceDataRow = DateShiftDataQueryFromKnitStore & {
    ShiftOpeCode?: string;
    ShiftOpeName?: string;
    CMBEmployee?: string;
    CMBScanTime?: string | null;
    BPJJScanTime?: string | null;
    OutStoreBillCode?: string;
    Status: string;
};

export type MisAppletsQRCodeData = {
    RowNo: number;
    QRCode: string;
    DispatchNo: string;
    OrderCode: string;
    StyleCode: string;
    Color: string;
    Size: string;
    ProductCode: string;
    ProductName: string;
    DataShiftStart: string;
    MachCode: number;
    Qty: number;
};

export type MisProductOutStoreBill = {
    BillID: string;
    BillCode: string;
    BillDate: string;
    CreateUser: string;
    CreateTime: string;
    Details: MisAppletsQRCodeData[] | null;
};

export type MisProductOutStoreBillListReq = {
    StartDate: string;
    EndDate: string;
};

export const misScheduleApi = {
    salary: (payload: SalaryDetailReq) =>
        http.postSchema('/mis/schedule/salary', SalaryDetailSchema.array(), payload),
    piecesCountGroup: (payload: SalaryPiecesCountGroupReq) =>
        http.postSchema(
            '/mis/schedule/salary/piecesCountGroup',
            SalaryPiecesCountGroupSchema.array(),
            payload,
        ),
    bonusMonth: (month: string) =>
        http.get<SalaryBonusMonth[]>('/mis/salary/bonusMonth', {month}),
    bonusMonthDetail: (month: string) =>
        http.get<SalaryBonusMonthDetail[]>('/mis/salary/bonusMonthDetail', {month}),
    bonusMachRate: (month: string, employeeNo: string) =>
        http.get<SalaryBonusMachRate[]>('/mis/salary/bonusMachRate', {month, employeeNo}),
    jxBonusMonth: (month: string) =>
        http.get<SalaryBonusMonth[]>('/mis/salary/jx/bonusMonth', {month}),
    jxBonusMonthDetail: (month: string) =>
        http.get<SalaryBonusMonthDetail[]>('/mis/salary/jx/bonusMonthDetail', {month}),
    jxBonusMachRate: (month: string, employeeNo: string) =>
        http.get<SalaryBonusMachRate[]>('/mis/salary/jx/bonusMachRate', {month, employeeNo}),
};

export const misProductionApi = {
    appletsData: (payload: MisProduceDataReq) =>
        http.postSchema(
            '/mis/productionMonitor/appletsData',
            DateShiftDataQueryFromKnitStoreSchema.array(),
            payload,
        ),
    appletsDataDelete: (id: string) =>
        http.delete<string>('/mis/productionMonitor/appletsData/del', {id}),
    changeScanQty: (barcode: string, qty: number, employeeNo: string) =>
        sqlApi.procedure({
            ProcedureName: '[transitDB].dbo.MisProduceScanQtyChange',
            Args: {
                barcoode: barcode,
                qty: String(qty),
                employeeNo,
            },
        }),
    productOutStoreQrcodeData: (qrcode: string) =>
        http.get<MisAppletsQRCodeData>('/mis/productOutStoreBill/qrcodeData', {qrcode}),
    productOutStoreBillSave: (qrcodes: MisAppletsQRCodeData[]) =>
        http.post<string>('/mis/productOutStoreBill/save', qrcodes),
    productOutStoreBillList: (payload: MisProductOutStoreBillListReq) =>
        http.post<MisProductOutStoreBill[]>('/mis/productOutStoreBill/list', payload),
    productOutStoreBillDelete: (billID: string) =>
        http.delete<string>('/mis/productOutStoreBill/del', {billID}),
};

export const misReportApi = {
    spinnerRate: async (startDate: string, endDate: string): Promise<SimpleDataTable> => {
        const result = await sqlApi.procedure({
            ProcedureName: '[172.20.2.254].dbNautilus.dbo.Query_YNSpinnerRate',
            Args: {StartDate: startDate, EndDate: endDate},
        });
        return result.data?.toDataTable() ?? {columns: [], rows: []};
    },
    mechanicRate: async (startDate: string, endDate: string): Promise<SimpleDataTable> => {
        const result = await sqlApi.procedure({
            ProcedureName: '[172.20.2.254].dbNautilus.dbo.Query_YNMechanicRate',
            Args: {StartDate: startDate, EndDate: endDate},
        });
        return result.data?.toDataTable() ?? {columns: [], rows: []};
    },
    /**
     * 越南挡车扫描数据由 Nautilus 视图提供。字段映射严格照旧客户端
     * `MisProductionMonitorAPI.appletsData` 的 SQL 分支。
     */
    async vnAppletsData(payload: MisProduceDataReq): Promise<MisProduceDataRow[]> {
        const conditions: string[] = [];
        const args: string[] = [];
        if (payload.StartTime) {
            conditions.push('STR_DATE1 >= ?');
            args.push(payload.StartTime);
        }
        if (payload.EndTime) {
            conditions.push('STR_DATE1 < ?');
            args.push(payload.EndTime);
        }
        if ((payload.MachCode ?? 0) > 0) {
            conditions.push('MAC_CODE = ?');
            args.push(String(payload.MachCode));
        }
        const sql = [
            'SELECT * FROM View_MisProduceScanInfo WHERE 1=1',
            conditions.length ? `AND ${conditions.join(' AND ')}` : '',
            'ORDER BY STR_DATE1, MAC_CODE DESC',
        ].filter(Boolean).join(' ');
        const result = await sqlApi.query({
            SQL: sql,
            Args: args,
            DataSource: DataSource.Nautilus,
        });
        return (result.data?.DataVals ?? [])
            .filter((row) => !isBlank(row.ShiftOPE))
            .map((row) => {
                const id = toStringOrEmpty(row.ID);
                const checkDown = row.CheckDown === '1';
                const flag = toNumberOrZero(row.Flag);
                const dateShiftStart = toStringOrEmpty(row.STR_DATE1);
                const dispatchNo = toStringOrEmpty(row.DispatchNo);
                const bpjjScanTime = isBlank(row.BPJJScanTime) ? null : toStringOrEmpty(row.BPJJScanTime);
                const billDate = toStringOrEmpty(row.BillDate);
                const billNo = toStringOrEmpty(row.BillNo);
                const outStoreBillCode = bpjjScanTime && billDate && billNo
                    ? `${billDate.replace(/-/g, '')}${billNo.padStart(4, '0')}`
                    : '';
                return {
                    ID: id,
                    Barcode: toStringOrEmpty(row.Barcode),
                    CheckDown: checkDown,
                    CheckDownTime: checkDown && !isBlank(row.CheckDownTime) ? toStringOrEmpty(row.CheckDownTime) : null,
                    CheckEmployee: toStringOrEmpty(row.CheckDownEmployeeName),
                    CheckEmployeeNo: toStringOrEmpty(row.CheckDownEmployeeNo),
                    CheckQty: checkDown ? toNumberOrZero(row.CheckQty) : 0,
                    Color: toStringOrEmpty(row.Color),
                    DateShiftEnd: toStringOrEmpty(row.DataShiftEnd),
                    DateShiftStart: dateShiftStart,
                    DispatchNo: dispatchNo,
                    Employee: toStringOrEmpty(row.EmployeeNo),
                    EmployeeName: toStringOrEmpty(row.EmployeeName),
                    Flag: flag,
                    InputTime: toStringOrEmpty(row.InputTime),
                    MachCode: toNumberOrZero(row.MAC_CODE),
                    OrderCode: toStringOrEmpty(row.OrderCode),
                    ProductName: toStringOrEmpty(row.ProductName),
                    ProductNo: toStringOrEmpty(row.ProductNo),
                    Qty: toNumberOrZero(row.Qty),
                    RoomCode: '越南',
                    ShiftName: toStringOrEmpty(row.SHIFT),
                    Size: toStringOrEmpty(row.Size),
                    StyleCode: toStringOrEmpty(row.StyleCode),
                    YarnColor: toStringOrEmpty(row.YarnColor),
                    ShiftOpeCode: toStringOrEmpty(row.ShiftOPE),
                    ShiftOpeName: toStringOrEmpty(row.ShiftOPEName),
                    CMBEmployee: toStringOrEmpty(row.CMBEmployee),
                    CMBScanTime: isBlank(row.CMBScanTime) ? null : toStringOrEmpty(row.CMBScanTime),
                    BPJJScanTime: bpjjScanTime,
                    OutStoreBillCode: outStoreBillCode,
                    Status: !dispatchNo ? '未扫描' : flag === 1 ? '已入库' : '',
                };
            });
    },
};

