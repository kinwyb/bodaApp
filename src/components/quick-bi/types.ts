/**
 * QuickBI 共用层的类型与配置契约。
 *
 * 对应旧客户端 `Views/Dialog/QuickBI.cs` 基类：V0357 下六个分析页
 * （V0358 供应链 / V0359 营销 / V0360 研发 / V0361 财务 / V0362 生产基地 / V0363 战略中心）
 * 都继承它，各自只重写几个虚拟方法。这里把那些重写点收敛成一份声明式配置：
 *
 * | C# 虚拟成员 | QuickBIConfig 字段 |
 * | --- | --- |
 * | getCaption() | caption（标题 / BIGroup / 导出文件名） |
 * | mainDataQuery(year, orgID) | mainProcedure + orgArgKey（V0358/V0359 的参数键是 OrgPk） |
 * | queryOrgProcedureName() | orgProcedure（缺省 Query_kpi_org） |
 * | defaultDetailProcedure() | detailProcedure |
 * | focusedData + initMergeColumn + sumColumn | detailProfile(kpi) |
 * | detailColumnType（未列名列一律 string） | detailColumnMode: 'text' |
 *
 * C# 的 detailDataArgs / mainDataColumnType 六个页面都没重写，暂不留口子。
 * queryBI 对空组织直接 return，所以 V0358/V0359「空组织省略参数」的分支实际不可达，不用配置。
 */
import type {AppColumnDef, MergeGroupConfig} from '@/components/grid-table';

/**
 * 某个指标的明细显示档案：C# 用 focusedData 记 zbType，再由 detailColumnType /
 * initMergeColumn / sumColumn 按 zbType 分支 —— 这里合成一个纯函数返回值。
 */
export type QuickBIDetailProfile = {
    /** 强制按两位小数数值显示的列（C# detailColumnType 返回 typeof(double)） */
    doubleFields?: readonly string[];
    /** 底部合计的列（C# sumColumn → SummaryItemType.Sum） */
    sumFields?: readonly string[];
    /** 按百分比显示的列（C# DisplayFormat "P2"：原值 × 100，两位小数 + %） */
    percentFields?: readonly string[];
    /** 明细纵向合并的层级列（C# detailMergeColumnSort）；不传 = 不合并 */
    mergeColumnSort?: readonly string[];
};

/** 一个 QuickBI 页面的全部差异点 */
export type QuickBIConfig = {
    /** 标题 / BIGroup / 导出文件名（C# getCaption()） */
    caption: string;
    /**
     * 页面一句话功能描述（guide.summary）。
     * **静态字符串，定义在页面目录的 bridged.ts（PAGE_GUIDE.summary）**：
     * 菜单描述脚本（scripts/sync-menu-descriptions.mjs）从那里提取生成 description.md，
     * 这里经 index.tsx 传进来给共用桥用 —— 三处同一份文案，不会漂移。
     */
    summary: string;
    /** 主表存储过程（C# mainDataQuery 里的 SQL.Procedure 名） */
    mainProcedure: string;
    /** 主表组织参数键名：V0360/V0361/V0362/V0363 用 OrgPK，V0358/V0359 用 OrgPk */
    orgArgKey?: 'OrgPK' | 'OrgPk';
    /** 组织候选存储过程（C# queryOrgProcedureName）；缺省 Query_kpi_org */
    orgProcedure?: string;
    /** 没配 BIViewConfig 时的兜底明细存储过程（C# defaultDetailProcedure） */
    detailProcedure: string;
    /**
     * 明细列类型口径：
     * - 'sql'（缺省）：按后端 ColumnTypes 推断（C# detailColumnType == null，V0360）；
     * - 'text'：只有 detailProfile 列名的 doubleFields / percentFields 按数值显示，
     *   其余列原样文本（C# 重写了 detailColumnType 且默认返回 typeof(string)，
     *   V0358/V0359/V0361/V0362/V0363）。文本模式下「日期」结尾列仍只留日期部分。
     */
    detailColumnMode?: 'sql' | 'text';
    /** 按「指标」取明细显示档案；不传 = 明细不做类型强化 / 合计 / 合并 */
    detailProfile?: (kpi: string) => QuickBIDetailProfile | undefined;
};

/** 明细标签页配置行（[transitDB].dbo.BIViewConfig，字段名与 C# 私有类一致） */
export type BiViewConfig = {
    BIViewConfigID: string;
    BIGroup: string;
    BIWork: string;
    BIKPI: string;
    BITag: string;
    BISQL: string;
    OrgID: string;
    SortNo: number;
};

/** 主表 / 明细表的一行：列由存储过程动态返回，没有固定 DTO */
export type KpiRecord = Record<string, unknown>;

/** 一个明细标签页的数据（C# 每个 XtraTabPage 里一个 GridControl） */
export type DetailTabData = {
    columns: AppColumnDef[];
    records: KpiRecord[];
    loading: boolean;
    /** 是否已经取过数：标签页首次切入时才加载（C# SelectedPageChanged 判 DataSource == null） */
    loaded: boolean;
    /** 明细合并配置（来自 detailProfile.mergeColumnSort） */
    mergeGroups?: MergeGroupConfig;
};

/** 明细取数目标：点了哪个指标行的哪一列（DateDecs = 列字段名） */
export type DetailTarget = {
    kpi: string;
    field: string;
};
