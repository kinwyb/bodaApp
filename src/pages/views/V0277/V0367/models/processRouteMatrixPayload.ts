/**
 * 点「保存」时，把**头部表单 + 工序明细表**组合成一份完整的 `ProcessRouteMatrix`。
 *
 * 单独一个文件的两个理由（与包装 BOM 的 `bomMatrixPayload` 一致）：
 * - 组合是**纯函数**：拿一组固定输入就能核对结果，接上接口只差一句 `api.save(...)`；
 * - `.tsx` 只导出组件（Fast Refresh 的硬要求），弹窗里放不下一个导出的装配函数。
 *
 * 三条口径：
 * - **明细只认表格的行**（`readRows('items')`，含未落库的增删改）：末尾那行「等输入」的空行
 *   不是明细，要滤掉（判据 `rowHasProcess`）；
 * - **表格写回的值要还原成接口的类型**：布尔列写回的是 `1 / 0`、枚举写回的是 `'2'`，
 *   而 schema 要 `boolean` / `number` —— 不转的话保存请求里全是字符串与数字，后端会当成脏数据；
 * - **身份字段跟着模式走**：编辑沿用主键与矩阵版本；新增 / 复制是「新的一份」，
 *   主键、矩阵版本、审计字段一律清空，明细行上的 `draft-N` 临时主键也不提交。
 *
 * 这里**只管装配**：必填 / 行内是否填全在 `./processRouteMatrixValidation`。
 */

import type {
    ProcessRouteMatrix,
    ProcessRouteMatrixDetail,
} from '@/api/schemas/nc/processRouteMatrix.ts';
import {isDraftRowKey, rowHasProcess} from '@/components/nc/processRouteMatrix/rows.ts';
import {toNumberOrNull, toStringOrEmpty} from '@/utils';
import type {FormMode} from '../command/types.ts';

/**
 * 表单上会落到**矩阵头**的字段。
 *
 * 两组主物料（包装 / 缝制）都在这里：包装物料是矩阵的主体（列表按它认行），
 * 缝制物料是工序要落到的那件产品 —— 与包装 BOM 的「包装成品 + 产成品」同一个结构。
 *
 * 其余头部字段（`Sizes` / `Colors` / `SizeMatch`）界面上没有入口，由 `...base` 原样带回去：
 * 它们描述的是「这份矩阵的尺码工时」，与工序明细无关，界面改动不该把它们抹掉。
 */
const MATRIX_HEAD_FIELDS = [
    // 包装成品（工艺路线挂在它身上）。版本 / 规格 / 型号接口里暂时没有，
    // 与包装 BOM 一样按同名占位一起提交：后端接上就不必回头补这一处
    'MaterialVID',
    'MaterialCode',
    'MaterialName',
    'MaterialVersion',
    'MaterialSpec',
    'MaterialModel',
    // 单位是一组（名称 + 主键 + 换算率）：只带名称，后端认不出单位
    'CMeasure',
    'CMeasureid',
    'Cassmeasure',
    'Cassmeasureid',
    'VChangerate',
    'PackMethod',
    'PackNum',
    // 项目主键与编码要一起提交：只有项目选择器能同时给出这两个
    'ProjectID',
    'ProjectCode',
    // 产成品（缝制物料）：接口只有 `SewMaterialVID`（关联键），其余是界面占位字段
    'SewMaterialVID',
    'SewMaterialCode',
    'SewMaterialName',
    'SewMaterialVersion',
    'SewMaterialSpec',
    'SewMaterialModel',
    'SewCMeasure',
    'SewCassmeasure',
    'SewVChangerate',
] as const;

/** 新增 / 复制时要抹掉的身份字段：它们属于「原来那一份」 */
const IDENTITY_FIELDS = [
    'ProcessRouteMatrixID',
    'MatrixVersion',
    'CreateTime',
    'CreateUser',
    'CreateUserNo',
    'UpdateTime',
    'UpdateUser',
    'UpdateUserNo',
] as const;

/** 布尔列：表格里写回 1 / 0，接口要 boolean */
const BOOLEAN_FIELDS = [
    'MainProcess',
    'CheckPoint',
    'CountPoint',
    'HandOverPoint',
    'OutProcess',
    'AllowAdd',
] as const;

export type ProcessRoutePayloadInput = {
    mode: FormMode;
    /** 底稿（弹窗里那份 `matrix`）：界面没管的字段从它带回来 */
    base?: ProcessRouteMatrix | null;
    /** 表单值，`form.getFieldsValue()` 原样给进来 */
    values: Record<string, unknown>;
    /** 工序明细的当前行（含未保存的增删改） */
    detail: Array<Record<string, unknown>>;
    /** 这份矩阵的主键（编辑 / 查看 / 新增保存成功后拿到的那个）；没有就传空 */
    matrixID?: string;
};

/**
 * 一行明细：清掉界面临时主键，补上归属（矩阵主键 / 矩阵版本），并把值还原成接口类型。
 */
function toDetailRow(
    row: Record<string, unknown>,
    matrixID: string,
    matrixVersion: number | null | undefined,
    keepIdentity: boolean,
): ProcessRouteMatrixDetail {
    const next: Record<string, unknown> = {...row};

    const detailID = toStringOrEmpty(next.ProcessRouteMatrixDetailID);
    /*
     * `draft-N` 是界面自己造的主键，后端不认识；编辑态的真主键要留着，
     * 否则后端只能「删一行再加一行」，那一行上的历史字段也跟着换身份。
     */
    next.ProcessRouteMatrixDetailID = keepIdentity && detailID && !isDraftRowKey(detailID)
        ? detailID
        : undefined;
    next.ProcessRouteMatrixID = matrixID || undefined;
    if (matrixVersion !== null && matrixVersion !== undefined) next.MatrixVersion = matrixVersion;

    // 行号统一成字符串：表格里可能是数字（用户敲进去的），接口要的是字符串
    next.VRowNo = toStringOrEmpty(next.VRowNo);

    // 勾选框写回的是 1 / 0，接口要 boolean
    BOOLEAN_FIELDS.forEach((field) => {
        const value = next[field];
        if (value === undefined || value === null || value === '') return;
        next[field] = Boolean(toNumberOrNull(value) ?? 0);
    });

    // 枚举下拉写回的是字符串 '2'，接口要数字
    const moveType = next.ProcessMoveType;
    if (moveType !== undefined && moveType !== null && moveType !== '') {
        next.ProcessMoveType = toNumberOrNull(moveType) ?? undefined;
    }

    return next as ProcessRouteMatrixDetail;
}

/**
 * 组合一份完整的工艺路线矩阵。
 *
 * 返回的是**业务模型形态**（`ProcessRouteMatrix`），可以直接交给
 * `processRouteMatrixApi.save` —— 明细里的日期本来就是 `YYYY-MM-DD` 字符串
 * （schema 里就是 string），不像包装 BOM 那样还要在提交前转 `Cbeginperiod` / `Cendperiod`。
 *
 * 清空过的字段在这里是 `undefined`：`JSON.stringify` 会把它丢掉（= 后端当没传）。
 */
export function buildProcessRouteMatrix(input: ProcessRoutePayloadInput): ProcessRouteMatrix {
    const {mode, base, values, detail} = input;
    const inputID = toStringOrEmpty(input.matrixID);
    /*
     * 身份字段跟「有没有落库」走，不是单纯看模式：新增保存成功后接口会回一个主键，
     * 之后再点保存就是**改这一份** —— 那时若还按 `mode === 'add'` 抹掉主键，等于每次都新插一条。
     * 复制永远是新的（`mode = 'copy'`）：拿的是原来那份的主键，必须抹掉。
     */
    const keepIdentity = mode !== 'copy' && (mode === 'edit' || inputID !== '');
    const matrixID = keepIdentity ? inputID : '';

    const rows = detail
        .filter(rowHasProcess)
        .map((row) => toDetailRow(
            row,
            matrixID,
            keepIdentity ? base?.MatrixVersion : undefined,
            keepIdentity,
        ));

    const payload: ProcessRouteMatrix = {
        // 打底：界面上没有入口的字段（缝制物料 / 尺码工时 / 创建人…）原样带回去
        ...(base ?? {}),
        Detail: rows,
    };

    /*
     * 表单上的字段**无条件覆盖**打底：用户清空过的字段也要如实变成「没有」，
     * 别让旧值留在里面。
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
