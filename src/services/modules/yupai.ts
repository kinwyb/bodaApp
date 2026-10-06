import { http } from '../request';
import type {PageQuery} from "@/services";

/** 尺码列标题，按界面原样展示 */
export const YupaiMachineSizeHeader = [
  '12/960',
  '12/1056',
  '13/1152',
  '14/1248',
  '15/1344',
  '16/1440',
  '17/1536',
  '18/1632',
  '19/1728',
  '20/1824',
  '13/1296',
  '14/1392',
  '15/1488',
  '16/1584',
  '17/1680',
  '18/1766',
  '21/1290',
  '21/1904'
];

export interface PreorderQuery extends PageQuery {
  keyword?: string;
  salesman?: string;
  workPlace?: string;
  /** 自定义筛选条件，JSON 字符串：{ 字段: { values?, min?, max?, text? } } */
  filters?: string;
}

/** 预订单列表记录，字段与后端 /preorders 返回一致 */
export interface YupaiOrder {
  ID: string;
  /** 预订日期 */
  YPDate: string;
  /** 业务员 */
  Ywy: string;
  /** 业务员工号 */
  YwyNo: string;
  /** 订单号 */
  OrderCode: string;
  /** 总数量 */
  Qty: number;
  /** 款号 */
  StyleCode: string;
  /** 款式描述 */
  ProduceName: string;
  /** 款式数量 */
  Number: number;
  /** 计划下单期 */
  JHDate: string;
  /** 确认下单期 */
  QRDate: string;
  /** 尾货期 */
  WCDate: string;
  /** 走货期 */
  ZHDate: string;
  /** 下单把握度 */
  XDRate: string;
  /** 备注 */
  Memo: string;
  /** 原料可下单期 */
  YLDate: string;
  /** 发料期 */
  FLDate: string;
  /** 包装发料期 */
  BZFLDate: string;
  /** 原料资料日期 */
  YLZLDate: string;
  /** 原料到货日期 */
  YLDHDate: string;
  /** 中期验货日期 */
  ZQCheckDate: string;
  /** 中期验货要求 */
  ZQCheckMemo: string;
  /** 后道主工序 */
  HDWorkName: string;
  /** 特殊工序 */
  TSWorkName: string;
  /** 预估颜色 */
  Color: string;
  /** 订单周期 */
  MCycle: string;
  /** 织造周期 */
  ZZCycle: number;
  /** 米重 */
  MWeight: string;
  /** 织造米重 */
  ZZMWeight: number;
  /** 缝制重量 */
  MSewWt: number;
  /** 产地工厂 */
  WorkPlace: string;
  /** 织造产地（组织机构 id） */
  KnitOrgID: string;
  /** 下单产地（组织机构 id） */
  OrgID: string;
  /** 产能阶段 */
  SSStep: number;
  /** 全码样阶段 */
  QMStep: number;
  /** 待客户反馈阶段 */
  WaitCustStep: number;
  /** 待订单阶段 */
  WaitOrderStep: number;
  /** 其它阶段 */
  OtherStep: string;
  /** 状态 */
  Status: number;
  CreateTime: string;
  CreateUser: string;
  UpdateTime: string;
  UpdateUser: string;
  /** 其余字段按原样保留 */
  [key: string]: unknown;
}

/** 变更清单记录（list/change 接口返回） */
export interface YupaiOrderChange {
  /** 0：整行变化；1：字段级变化 */
  Action: number;
  /** 订单 ID，对应列表的 ID */
  YupaiOrderID: string;
  /** 发生变化的字段名，为空表示整行变化 */
  FieldName: string;
}

/** 订单 ID -> 变更字段（空数组表示整行变化） */
export type PreorderChangeMap = Record<string, string[]>;

export const yupaiOrderService = {
  list: (query: PreorderQuery = {}) => http.get<YupaiOrder[]>('/preorders', query),
  /** 最近发生变化的明细 */
  changes: () => http.get<YupaiOrderChange[]>('/preorders/changes'),
  /** 新增预订单 */
  create: (payload: Partial<YupaiOrder>) => http.post<YupaiOrder>('/preorders', payload),
  /** 修改预订单 */
  update: (id: string, payload: Partial<YupaiOrder>) =>
    http.put<YupaiOrder>(`/preorders/${encodeURIComponent(id)}`, payload),
};
