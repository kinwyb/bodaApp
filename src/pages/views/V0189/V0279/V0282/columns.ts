import {YupaiMachineSizeHeader} from '@/api';
import type {AppColumnDef} from '@/components/grid-table/columnBuilder.ts';

/**
 * 机型尺码列的数量。
 *
 * 后端有 `MCSize1..MCSize18`，第 18 列在旧客户端设计器里是**隐藏列**（标题还标着「无效」），
 * 却仍挂在组汇总里 —— 等于把一个业务上作废的机型混进合计。新界面只取前 17 个：
 * 既不显示、也不参与汇总，数字才对得上真实机型。
 */
const MACHINE_SIZE_COUNT = 17;

/**
 * 尺码列：一列一个机型（标题是「寸/针」简写，12/960 = 12 寸 960 针）。
 *
 * 三件事都靠这一份配置：
 * - `aggregate: 'sum'` —— 组行与底部统计行自动求和，页面不用手算；
 * - `fieldFormat` —— 旧客户端 `CustomDrawCell` 把 `0` 画成空白，这里同样处理
 *   （0 与「没排产」在这个页面上是同一件事）；
 * - `width: 82` —— 18 列并排，宽度必须收着来。
 */
const sizeColumns: AppColumnDef[] = YupaiMachineSizeHeader
    .slice(0, MACHINE_SIZE_COUNT)
    .map((title, index) => {
        const field = `MCSize${index + 1}`;
        return {
            field,
            title,
            width: 82,
            dataType: 'int' as const,
            aggregate: 'sum' as const,
            fieldFormat: (record: Record<string, unknown>) => {
                const value = record[field];
                if (value === null || value === undefined || value === '') return '';
                return Number(value) > 0 ? value : '';
            },
        };
    });

/**
 * 「预排汇总」列定义。
 *
 * 顺序照旧客户端 `V0282.Designer.cs` 的 `VisibleIndex` 排（产地与出货月份都是 0，
 * 出货月份是分组列、排在更前）；`XDMonth`（下单月份）是**界面派生列**，
 * 后端不返回，由页面按 `QRDate` 算成 `YYYY-MM` 后塞进记录（对应旧客户端的
 * `UnboundExpression = Concat(GetYear([QRDate]),'-',PadLeft(GetMonth([QRDate]),2,'0'))`）。
 */
export const PRESCHEDULE_COLUMNS: AppColumnDef[] = [
    {
        field: 'ZHMonth',
        title: '出货月份',
        width: 100,
        // 旧客户端 GroupCount = 1 且按它升序分组，进来就是收起的分组表
        group: true,
        sortable: 'asc',
    },
    {field: 'WorkPlace', title: '产地', width: 90, filterType: 'enum'},
    {field: 'YPDate', title: '预排日期', width: 100, dataType: 'date', sortable: true, filterType: 'date'},
    {field: 'Ywy', title: '业务员', width: 85, filterType: 'enum'},
    {field: 'OrderCode', title: '订单号', width: 110, filterType: 'text'},
    {field: 'Qty', title: '总数量', width: 90, dataType: 'int', sortable: true},
    {field: 'Number', title: '款式数量', width: 85, dataType: 'int', sortable: true, aggregate: 'sum'},
    {field: 'StyleCode', title: '款号', width: 110, filterType: 'text'},
    {field: 'ProduceName', title: '款式描述', width: 150, filterType: 'enum'},
    {field: 'Color', title: '预估颜色', width: 140},
    {field: 'HDWorkName', title: '后道主工序', width: 100, filterType: 'enum'},
    {field: 'XDMonth', title: '下单月份', width: 100, sortable: true},
    {field: 'JHDate', title: '计划下单期', width: 105, dataType: 'date', filterType: 'date'},
    {field: 'QRDate', title: '确认下单期', width: 105, dataType: 'date', filterType: 'date'},
    {field: 'WCDate', title: '尾查期', width: 100, dataType: 'date'},
    {field: 'ZHDate', title: '走货期', width: 100, dataType: 'date', filterType: 'date'},
    {field: 'XDRate', title: '下单把握率', width: 100, style: {textAlign: 'right'}},
    {field: 'Memo', title: '备注', width: 180},
    {field: 'YLDate', title: '原料可下单期', width: 115, dataType: 'date'},
    {field: 'FLDate', title: '辅料可下单期', width: 115, dataType: 'date'},
    {field: 'MCycle', title: '中码下机时间', width: 115},
    {field: 'MWeight', title: '中码下机克重', width: 115, style: {textAlign: 'right'}},
    {field: 'MSewWt', title: '缝制工时', width: 95, dataType: 'double'},
    ...sizeColumns,
    {field: 'CreateTime', title: '创建时间', width: 150, dataType: 'datetime'},
    {field: 'CreateUser', title: '创建人', width: 90},
    {field: 'UpdateTime', title: '最后修改时间', width: 150, dataType: 'datetime'},
    {field: 'UpdateUser', title: '最后修改人', width: 100},
];
