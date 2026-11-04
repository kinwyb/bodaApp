/**
 * 点「保存」时，把**界面上的两份表单 + 三张表**组合成一个完整的 `PackBomMatrix`。
 *
 * 为什么单独一个文件：
 * - 组合是**纯函数**（不给它 Form 实例、也不给表格实例），拿一组固定输入就能核对结果；
 *   将来接上保存接口，只差一句 `packBomMatrixApi.save(buildPackBomMatrix(...).payload)`；
 * - `.tsx` 只导出组件（Fast Refresh 的硬要求），弹窗那个文件里放不下一个导出的装配函数；
 * - 装配规则只有一处：界面上的「保存」与 agent 的 `form.submit` 都调它 ——
 *   两边各写一份，迟早出现「界面存进去 12 行、agent 存进去 11 行」这种对不上的事故。
 *
 * 三条口径：
 * - **明细只认表格的行**（`readRows('items')`，含未落库的增删改）：格子里的物料字段是用户改过的，
 *   拿 `matrix.Detail` 拼等于把改动丢掉。末尾那行「等输入」的空行（没有物料）不是明细，要滤掉；
 * - **配色 / 配码由表格行反推**（`rebuildColorMatch` / `rebuildSizeMatch`）：`ColorMatch` /
 *   `SizeMatch` 是接口原始数据，界面增删行一概不动它们，只在这里对齐一次；
 * - **身份字段跟着模式走**：编辑沿用主键与矩阵版本；新增 / 复制是「新的一份」，
 *   主键、矩阵版本、审计字段一律清空，明细行上的 `draft-N` 临时主键也不提交 —— 它不是数据。
 *
 * 这里**只管装配**：必填 / 辅助属性是否填全 / 是否重复，都在 `./bomMatrixValidation`。
 */

import type {PackBomMatrix, PackBomMatrixDetail} from '@/api/schemas/nc/bomMatrix.ts';
import {rebuildColorMatch, rebuildSizeMatch} from '@/components/nc/bomMatrix/match.ts';
import {isBlank, toStringOrEmpty} from '@/utils';
import type {FormMode} from '../command/types.ts';

/**
 * 表单上会落到**矩阵头**的字段。
 *
 * 其余表单字段（`SewMaterialName` / `SewCMeasure` 等）只活在明细第 10 行 ——
 * 矩阵头没有它们的容身之处，产成品的属性本来就该跟着那一行走。
 *
 * `PackMaterialVersion` / `PackMaterialSpec` / `PackMaterialModel` 接口里暂时没有（见弹窗文件头），
 * 先按同名占位一起提交：接上后端以后不用回来补这一处。
 */
const MATRIX_HEAD_FIELDS = [
    'PackMaterialVID',
    'PackMaterialCode',
    'PackMaterialName',
    'PackMaterialVersion',
    'PackMaterialSpec',
    'PackMaterialModel',
    'CMeasure',
    'CMeasureid',
    'Cassmeasure',
    'Cassmeasureid',
    'VChangerate',
    'PackMethod',
    'PackNum',
    'ProjectCode',
    'SewMaterialVID',
] as const;

/** 新增 / 复制时要抹掉的身份字段：它们属于「原来那一份」 */
const IDENTITY_FIELDS = [
    'PackBomMatrixID',
    'MatrixVersion',
    'CreateTime',
    'CreateUser',
    'CreateUserNo',
    'UpdateTime',
    'UpdateUser',
    'UpdateUserNo',
] as const;

/** 未落库的新行主键前缀（见 `components/nc/bomMatrix/rows.ts` 的 `nextDraftRowKey`） */
const DRAFT_ID_PREFIX = 'draft-';

export type BomMatrixPayloadInput = {
    mode: FormMode;
    /** 底稿（弹窗里派生出来的那份 `matrix`）：界面没管的字段（项目主键 / 创建人…）从它带回来 */
    base?: PackBomMatrix | null;
    /** 表单值，`form.getFieldsValue()` 原样给进来 */
    values: Record<string, unknown>;
    /** 子项物料表的当前行（含未保存的增删改） */
    detail: Array<Record<string, unknown>>;
    /** 配色表的当前行 */
    colorRows: Array<Record<string, unknown>>;
    /** 配码表的当前行 */
    sizeRows: Array<Record<string, unknown>>;
    /** 颜色列（`matrix.ColorSort`）—— 只提交这些列，列没了数据也不该留着 */
    colorSort?: Array<string | null | undefined> | null;
    /** 尺码列（`matrix.SizeSort`） */
    sizeSort?: Array<string | null | undefined> | null;
    /** 编辑态的主键；新增 / 复制传空 */
    matrixID?: string;
};

/**
 * 这一行算不算明细：编辑态末尾永远留一行等用户选物料（见 itemView 的 `ensureBlankAfter`），
 * 它只有行号没有物料 —— 既不是明细，也不该参与校验。
 *
 * 装配与校验必须用**同一个判据**，所以放在这里（两边都 import 这一份）。
 */
export const isMaterialRow = (row: Record<string, unknown>): boolean =>
    !isBlank(row.MaterialVID) || !isBlank(row.MaterialCode);

/** 一行明细：清掉界面临时主键，补上归属（矩阵主键 / 矩阵版本） */
function toDetailRow(
    row: Record<string, unknown>,
    matrixID: string,
    matrixVersion: number | null | undefined,
    keepIdentity: boolean,
): PackBomMatrixDetail {
    const next: Record<string, unknown> = {...row};
    const detailID = toStringOrEmpty(next.PackBomMatrixDetailID);
    /*
     * `draft-N` 是界面为了跨表对齐行自己造的，后端不认识；编辑态的真主键要留着，
     * 否则后端只能「删一行再加一行」，那一行上的历史字段也跟着换身份。
     */
    next.PackBomMatrixDetailID = keepIdentity && detailID && !detailID.startsWith(DRAFT_ID_PREFIX)
        ? detailID
        : undefined;
    next.PackBomMatrixID = matrixID || undefined;
    if (matrixVersion !== null && matrixVersion !== undefined) next.MatrixVersion = matrixVersion;
    // 行号统一成字符串：表格里可能是数字（用户敲进去的），接口要的是字符串
    next.VRowNo = toStringOrEmpty(next.VRowNo);
    return next as PackBomMatrixDetail;
}

/**
 * 组合一份完整的包装 BOM 矩阵。
 *
 * **只装配、不校验**：必填 / 辅助属性是否填全 / 是否重复都在 `./bomMatrixValidation`，
 * 保存流程先过那一关再调这里（两件事混在一起，将来改校验规则得翻装配代码）。
 *
 * 返回的是**业务模型形态**（`PackBomMatrix`）：明细的 `BeginDate` / `EndDate` 还是 `Dayjs`
 * （与 `PackBomMatrixDetailSchema` 的转换结果一致）。真发请求时在接口层把这两个字段转成
 * `Cbeginperiod` / `Cendperiod`（`toDateString`）—— 只在这一层转一次，别在装配里混两套形态。
 *
 * 清空过的字段在这里是 `undefined`：`JSON.stringify` 会把它丢掉（= 后端当没传）。
 * 接上保存接口后若要「清空」，按后端语义换成 `null` / `''` —— 位置就是 `MATRIX_HEAD_FIELDS` 这一处。
 */
export function buildPackBomMatrix(input: BomMatrixPayloadInput): PackBomMatrix {
    const {mode, base, values, detail, colorRows, sizeRows, colorSort, sizeSort} = input;
    const keepIdentity = mode === 'edit';
    const matrixID = keepIdentity ? toStringOrEmpty(input.matrixID) : '';

    /*
     * 空行不是明细（判据见 `isMaterialRow`）。
     *
     * 矩阵版本只在编辑态往行上写：新增 / 复制是新的一份，行跟着旧版本号没有意义。
     */
    const rows = detail
        .filter(isMaterialRow)
        .map((row) => toDetailRow(
            row,
            matrixID,
            keepIdentity ? base?.MatrixVersion : undefined,
            keepIdentity,
        ));

    const payload: PackBomMatrix = {
        // 打底：界面上没有入口的字段（ProjectID / 创建人 / 矩阵版本…）原样带回去
        ...(base ?? {}),
        Detail: rows,
        ColorMatch: rebuildColorMatch(colorRows, colorSort ?? []),
        SizeMatch: rebuildSizeMatch(sizeRows, sizeSort ?? []),
        // 列清单跟着产成品走：只留当前这几列，换了产成品旧列的数据不该继续提交
        ColorSort: (colorSort ?? []).map((item) => toStringOrEmpty(item)).filter((item) => item !== ''),
        SizeSort: (sizeSort ?? []).map((item) => toStringOrEmpty(item)).filter((item) => item !== ''),
    };

    /*
     * 表单上的字段**无条件覆盖**打底：用户清空过的字段也要如实变成「没有」，别让旧值留在里面。
     * 按 `Record` 写：`PackMaterialVersion` 这几个是占位字段（schema 里还没有），
     * 直接 `payload[field]` 会落进索引签名的 `unknown`。
     */
    const head = payload as Record<string, unknown>;
    MATRIX_HEAD_FIELDS.forEach((field) => {
        head[field] = values[field];
    });

    if (!keepIdentity) {
        // 复制 / 新增都是新的一份：主键、矩阵版本、审计字段都不属于它
        IDENTITY_FIELDS.forEach((field) => {
            head[field] = undefined;
        });
    }

    return payload;
}
