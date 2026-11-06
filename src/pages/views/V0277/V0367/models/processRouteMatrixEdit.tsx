/**
 * 新增 / 编辑 / 复制工艺路线矩阵的表单弹窗。
 *
 * **上半部分与包装 BOM 矩阵（V0354/models/bomMatrixEdit）一模一样**：两组主物料
 * （包装成品 / 产成品），字段同样是「物料编码 + 名称 / 版本 / 规格 / 型号 / 主单位 /
 * 转换率 / 单位 + 包装方法 / 包装数量 / 项目」。物料编码是唯一的手填入口，
 * 其余字段都由物料档案带出 —— 手填会出现「编码是 A、名称却是 B」。
 *
 * 两套矩阵的差别只有字段名：BOM 那边叫 `PackMaterialXXX`，工艺这边叫 `MaterialXXX`
 * （缝制物料两组都叫 `SewMaterialXXX`）。
 *
 * **保存**：校验（`./processRouteMatrixValidation`）→ 组合完整 `ProcessRouteMatrix`
 * （`./processRouteMatrixPayload`）→ `processRouteMatrixApi.save` 落库 →
 * **按返回的 `ProcessRouteMatrixID` 重新取一遍详情**：接口会补上界面拼不出来的东西
 * （明细主键、矩阵版本…），重取之后这份记录才有身份。
 *
 * 下半部分是**编辑态的工序明细表**（`ProcessRouteMatrixView isEditMode`）：
 * 与包装 BOM 不同，这里只有一张表，没有配色 / 配码，所以没有跨表同步要照顾。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, Divider, Form, Input, Modal, Select, Spin} from 'antd';
import {CloudUploadOutlined, SaveOutlined} from '@ant-design/icons';
import {ProcessRouteMatrixView, type ProcessRouteMatrixViewApi,} from '@/components/nc/processRouteMatrix';
import {DEFAULT_PROCESS_ROUTE_SECTION} from '@/components/nc/processRouteMatrix/sections.ts';
import MaterialSelect from '@/components/nc/materialSelect.tsx';
import ConvertSelect from '@/components/nc/convertSelect.tsx';
import ProjectSelect from '@/components/nc/projectSelect.tsx';
import {putConverts} from '@/components/nc/convertCache.ts';
import MatrixPushModal, {type MatrixPushApi} from '@/components/nc/matrixPushModal.tsx';
import type {NCMaterial, NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import type {NCProject} from '@/api/schemas/nc/NCBase.ts';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import {
    processRouteMatrixApi,
    type processRouteFeature,
} from '@/api/modules/nc/processRouteMatrix.ts';
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import {ErrorMessage} from '@/api/request.ts';
import {isBlank, toStringOrEmpty} from '@/utils';
import {buildProcessRouteMatrix} from './processRouteMatrixPayload.ts';
import {validateProcessRouteMatrix} from './processRouteMatrixValidation.ts';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import type {FormMode} from '../command';
import {
    createProcessRouteEditBridge,
    PACK_FIELDS,
    SEW_FIELDS,
    type ProcessRouteEditBridgeContext,
    type ProcessRouteFieldGroup,
    type ProcessRouteFormField,
} from './processRouteMatrixEditBridge.ts';
import './processRouteMatrixEdit.css';

export type ProcessRouteMatrixEditProps = {
    open: boolean;
    /**
     * 所属页面的 view（菜单的 View 字段）。
     *
     * 界面桥按 view 找「这一页上打开的是哪个弹窗」，所以弹窗必须知道自己站在哪个页面里 ——
     * 打开期间它顶掉页面的工具栏动作与列表数据，关闭后把视野还给页面。
     */
    view: string;
    /** add / edit / copy；view 也支持（只读预览，复用同一份布局） */
    mode: FormMode;
    /** 编辑 / 复制时的底稿；新增为 null */
    record: ProcessRouteMatrix | null;
    /**
     * 保存成功后的通知（参数是落库后的 `ProcessRouteMatrixID`）。
     *
     * 页面拿它去刷新列表 —— 不刷新的话新存的这份在关掉弹窗后仍然看不见。
     */
    onSaved?: (matrixID: string) => void;
    onClose: () => void;
};

/**
 * 保存的结果。
 *
 * `ok=false` 时 `message` 说清原因；`issues` 只有「校验没通过」才有（那几条要逐条列给用户），
 * 接口失败只有一句 toast，不重复弹框。
 */
type SaveOutcome = { ok: boolean; message: string; issues?: string[] };

/**
 * 发布弹窗要的四个接口。
 *
 * 模块级常量：它是 `MatrixPushModal` 的 `loadRules` 依赖，每次渲染新建对象会让
 * 「打开就取规则」的 effect 反复触发。
 */
const PUSH_API: MatrixPushApi = {
    rules: processRouteMatrixApi.pushRules,
    push: processRouteMatrixApi.push,
    cancelPush: processRouteMatrixApi.cancelPush,
    updatePush: processRouteMatrixApi.updatePush,
};

/** 标题按模式来：复制与新增是同一套空表单，但用户要知道自己在复制哪一份 */
const MODE_TITLE: Record<FormMode, string> = {
    add: '新增工艺路线矩阵',
    edit: '编辑工艺路线矩阵',
    copy: '复制工艺路线矩阵',
    view: '查看工艺路线矩阵',
};

/** 存下来之后统一叫「编辑」：新增 / 复制一旦落库，改的就是已有记录 */
const EDIT_TITLE = '编辑工艺路线矩阵';

/** 表单里两组字段：包装成品（4 开头物料）与产成品（3 开头物料） */
const GROUP_TITLE: Record<ProcessRouteFieldGroup, string> = {
    pack: '包装成品',
    sew: '产成品',
};

/*
 * 两组的字段表在 `./processRouteMatrixEditBridge`：那份**同时**被下面的 JSX 与界面桥使用 ——
 * 界面上少一个字段，agent 那儿也就少一条。字段的控件形态由 `material` / `convert` /
 * `project` / `feature` 四个标记说明（见 `renderControl`）。
 */

/** 标题旁那一行「是哪一份矩阵」：物料编码 + 名称 */
function matrixLabelOf(matrix: ProcessRouteMatrix): string {
    const parts = [toStringOrEmpty(matrix.MaterialCode), toStringOrEmpty(matrix.MaterialName)]
        .map((text) => text.trim())
        .filter((text) => text !== '');
    return parts.join(' ');
}

const ProcessRouteMatrixEdit: React.FC<ProcessRouteMatrixEditProps> = ({
                                                                           open, view, mode, record, onSaved, onClose,
                                                                       }) => {

    const {message, modal} = App.useApp();
    const [form] = Form.useForm<Record<string, unknown>>();
    const matrixRef = useRef<ProcessRouteMatrixViewApi | null>(null);

    /**
     * 当前这份矩阵（详情）。表格按它的 `Detail` 铺行；换矩阵时引用一变，
     * 表格里的本地编辑自动作废（见 `useEditableRows`）。
     *
     * 初值直接取底稿：页面每次打开都用新的 `key` 重挂载这个弹窗，
     * 所以不需要「在 effect 里按 record 重置 state」那一套。
     */
    const [baseRecord, setBaseRecord] = useState<ProcessRouteMatrix>(record ?? {});
    /** 已落库的主键：决定「保存」是新增还是更新，也决定「发布」能不能点 */
    const [recordID, setRecordID] = useState<string>(() => toStringOrEmpty(record?.ProcessRouteMatrixID));
    /**
     * 详情在路上的占位。
     *
     * 初值就有主键时直接置 true：这一帧表格还没拿到 `Detail`，先渲染就会被当成空矩阵、
     * 编辑态还会立刻补一行空行，详情一到整块重铺 —— 用户看到的是空表闪一下。
     */
    const [loadingDetail, setLoadingDetail] = useState<boolean>(
        () => toStringOrEmpty(record?.ProcessRouteMatrixID) !== '',
    );
    const [saving, setSaving] = useState(false);
    /** 当前标签页受控在弹窗里（控件内部不存，见 `ProcessRouteMatrixView` 的注释） */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_PROCESS_ROUTE_SECTION);
    const [pushOpen, setPushOpen] = useState(false);

    /** 「特性」下拉的候选：这个包装物料在包装 BOM 里已有的组合（按物料查，物料变了就重查） */
    const [features, setFeatures] = useState<processRouteFeature[]>([]);
    const [featuresLoading, setFeaturesLoading] = useState(false);

    /**
     * 两个物料的主键：单位选择器的候选单位按它取。
     *
     * 用 `Form.useWatch` 而不是直接读 ref：`MaterialVID` / `SewMaterialVID` 都注册成了
     * 隐藏的 `Form.Item`（`useWatch` 只看**已注册字段**），所以物料一变这里就跟着变。
     */
    const materialVID = toStringOrEmpty(Form.useWatch('MaterialVID', form));
    const sewMaterialVID = toStringOrEmpty(Form.useWatch('SewMaterialVID', form));
    /** 只拿到编码也算选过：历史数据里可能只有编码、没有 VID */
    const sewMaterialCode = toStringOrEmpty(Form.useWatch('SewMaterialCode', form));
    /** 包装物料编码：「特性」的候选按它查（物料一变，选项跟着变） */
    const materialCode = toStringOrEmpty(Form.useWatch('MaterialCode', form));

    /**
     * 缝制物料选没选 —— 它决定下面工序明细能不能编。
     *
     * 道理与包装 BOM 里「产成品没选 → 子项明细整块禁用」一样：工序明细是**这个缝制物料的**
     * 工艺路线，没有缝制物料就录明细，等于把行挂到空气上（保存时后端也只能丢掉它们）。
     */
    const hasSewMaterial = sewMaterialVID !== '' || sewMaterialCode !== '';

    /**
     * 请求序号：关掉弹窗 / 换一份记录时，让在飞的详情请求作废。
     * 不挡的话「打开 A 又立刻换 B」会把 A 的详情写进 B 的界面。
     */
    const seqRef = useRef(0);
    /** 物料档案回查的序号：重试 / 换底稿时只认最后一次的结果 */
    const archiveSeqRef = useRef(0);
    /** 特性候选的序号：换物料时丢掉上一趟的结果（否则会把旧物料的组合填进新物料） */
    const featureSeqRef = useRef(0);
    /** 上次查过特性的物料 VID：只在它变化时重查（编码每敲一个字母都会变，不能当触发条件） */
    const featureVIDRef = useRef<string | null>(null);

    const hasRecord = recordID !== '';
    const isEditable = mode !== 'view';
    /** 明细能不能编：可编辑模式 + 已经选了缝制物料 */
    const canEditItems = isEditable && hasSewMaterial;

    /** 取详情：拿回来的才是完整矩阵（列表行只有摘要，没有 `Detail`） */
    const loadDetail = useCallback(async (id: string) => {
        const seq = ++seqRef.current;
        setLoadingDetail(true);
        try {
            const result = await processRouteMatrixApi.detail(id);
            if (seq !== seqRef.current) return;
            if (result.data) {
                setBaseRecord(result.data);
                // 详情比列表行全：把表单也补齐（单位、主键这些只在详情里）
                form.setFieldsValue(result.data as Record<string, unknown>);
            }
        } catch (err) {
            if (seq !== seqRef.current) return;
            void message.error(ErrorMessage(err, '矩阵详情加载失败'));
        } finally {
            if (seq === seqRef.current) setLoadingDetail(false);
        }
    }, [form, message]);

    /**
     * 选中包装成品：**一组字段一起换**。
     *
     * 编码、名称、版本、规格、型号、主单位、单位、换算率必须同源 —— 只换编码会留下
     * 「编码是新的、名称与单位还是上一个物料」的半截数据，保存时后端按旧单位换算，数量就错了。
     *
     * @param options.keepUnits 保留表单里已有的「单位 + 换算率」。
     *   编辑打开时用：库里存的是用户当时选的单位，物料档案里第一个换算单位不一定是它，
     *   无声替换等于替用户改了单据。
     */
    const applyMaterial = useCallback((material: NCMaterial, options?: { keepUnits?: boolean }) => {
        const convert = material.materialconvert?.[0];
        // 单位列表当场登记进缓存：点「单位」时弹窗一打开就是满的，不用再回查一次接口
        putConverts(toStringOrEmpty(material.pk_material), material.materialconvert);
        const fields: Record<string, unknown> = {
            MaterialVID: material.pk_material,
            MaterialCode: material.code,
            MaterialName: material.name,
            MaterialSpec: material.materialspec,
            MaterialModel: material.materialtype,
            MaterialVersion: material.version,
            CMeasure: material.measdoc,
            // 主单位的主键：矩阵头上与明细行一样要带（保存时后端按它认单位）
            CMeasureid: material.pk_measdoc,
        };
        if (!options?.keepUnits) {
            fields.Cassmeasure = convert?.measdoc ?? material.measdoc;
            fields.Cassmeasureid = convert?.pk_measdoc ?? material.pk_measdoc;
            fields.VChangerate = convert?.measrate ?? '1/1';
        } else if (isBlank(form.getFieldValue('Cassmeasureid'))) {
            // 详情没带单位主键（历史数据）：按库里存的单位名，在物料档案里对上一条
            const kept = toStringOrEmpty(form.getFieldValue('Cassmeasure')).trim();
            const matched = (material.materialconvert ?? []).find(
                (item) => toStringOrEmpty(item.measdoc).trim() === kept,
            );
            if (!isBlank(matched?.pk_measdoc)) fields.Cassmeasureid = matched?.pk_measdoc;
        }
        form.setFieldsValue(fields);
    }, [form]);

    /** 包装成品被清空：名称 / 版本 / 单位这些全部清掉，别留下指着旧物料的脏数据 */
    const clearMaterial = useCallback(() => {
        form.setFieldsValue({
            MaterialVID: undefined,
            MaterialName: undefined,
            MaterialVersion: undefined,
            MaterialSpec: undefined,
            MaterialModel: undefined,
            CMeasure: undefined,
            CMeasureid: undefined,
            Cassmeasure: undefined,
            Cassmeasureid: undefined,
            VChangerate: undefined,
        });
    }, [form]);

    /**
     * 选中产成品（缝制物料）：与包装成品同一个口径，字段名换成 `Sew*`。
     *
     * 接口头里只有 `SewMaterialVID`（关联键），编码 / 名称 / 版本这些是界面占位字段：
     * 保存时一并提交（同包装 BOM 的处理，后端接上就不用回头改这里）。
     */
    const applySewMaterial = useCallback((material: NCMaterial, options?: { keepUnits?: boolean }) => {
        const convert = material.materialconvert?.[0];
        putConverts(toStringOrEmpty(material.pk_material), material.materialconvert);
        const fields: Record<string, unknown> = {
            SewMaterialVID: material.pk_material,
            SewMaterialCode: material.code,
            SewMaterialName: material.name,
            SewMaterialSpec: material.materialspec,
            SewMaterialModel: material.materialtype,
            SewMaterialVersion: material.version,
            SewCMeasure: material.measdoc,
        };
        if (!options?.keepUnits) {
            fields.SewCassmeasure = convert?.measdoc ?? material.measdoc;
            fields.SewVChangerate = convert?.measrate ?? '1/1';
        }
        form.setFieldsValue(fields);
    }, [form]);

    /** 产成品被清空：关联键与名称一起清 */
    const clearSewMaterial = useCallback(() => {
        form.setFieldsValue({
            SewMaterialVID: undefined,
            SewMaterialName: undefined,
            SewMaterialVersion: undefined,
            SewMaterialSpec: undefined,
            SewMaterialModel: undefined,
            SewCMeasure: undefined,
            SewCassmeasure: undefined,
            SewVChangerate: undefined,
        });
    }, [form]);

    /** 选中包装成品的单位：单位名 / 单位主键 / 换算率一组一起换 */
    const applyConvert = useCallback((convert: NCMaterialConvert) => {
        form.setFieldsValue({
            Cassmeasure: convert.measdoc,
            Cassmeasureid: convert.pk_measdoc,
            VChangerate: convert.measrate,
        });
    }, [form]);

    /** 选中产成品的单位：同上，字段名换成 `Sew*` */
    const applySewConvert = useCallback((convert: NCMaterialConvert) => {
        form.setFieldsValue({
            SewCassmeasure: convert.measdoc,
            SewVChangerate: convert.measrate,
        });
    }, [form]);

    /** 选中项目：编码与主键是一组（后端两个都要，只留编码会被挡下） */
    const applyProject = useCallback((project: NCProject) => {
        form.setFieldsValue({
            ProjectID: project.pk_project,
            ProjectCode: project.project_name,
        });
    }, [form]);

    /** 项目被清空：主键一并清掉，否则保存时后端会按旧项目入库 */
    const clearProject = useCallback(() => {
        form.setFieldsValue({ProjectID: undefined});
    }, [form]);

    /**
     * 按底稿里的物料主键回查一次物料档案（编辑 / 复制 / 查看打开时）。
     *
     * 为什么要查：详情接口只给编码 / 名称 / 主键，**没有版本、规格、型号、主单位** ——
     * 不查的话编辑一打开这几个格子全是空的，看着像数据丢了；顺便把换算单位登记进缓存。
     *
     * 查不到不算失败：档案里没有这个物料（历史脏数据）时只说一句，表单照样能看能改。
     */
    const loadArchive = useCallback(async (group: ProcessRouteFieldGroup, vid: string, code: string) => {
        if (!vid && !code) return;
        const seq = ++archiveSeqRef.current;
        try {
            // 优先按主键查（同编码可能有多个版本）；只拿到编码时才按编码查
            const result = await ncMaterialApi.query(vid ? {materialPK: vid} : {code});
            if (seq !== archiveSeqRef.current) return;
            const list = result.data ?? [];
            const material =
                list.find((item) => toStringOrEmpty(item.pk_material) === vid)
                ?? list.find((item) => toStringOrEmpty(item.code) === code)
                ?? list[0];
            if (!material) return;
            // 保留库里存的单位：物料档案里第一个换算单位不一定是用户当时选的那个
            if (group === 'pack') applyMaterial(material, {keepUnits: true});
            else applySewMaterial(material, {keepUnits: false});
        } catch {
            // 档案查失败不影响改单：名称 / 单位照旧从详情带出来，保存以编码为准
        }
    }, [applyMaterial, applySewMaterial]);

    /**
     * 查「特性」候选：**按包装物料编码**（`processRouteMatrixApi.features` 从包装 BOM 里
     * 按 `PackMethod / PackNum / ProjectID / ProjectCode / SewMaterialVID` 分组拿组合）。
     *
     * 触发条件是 `MaterialVID`（**不是编码**）：`MaterialCode` 每敲一个字母都会变，
     * 拿它当依赖就成了「输一个编码打十几次 SQL」。VID 只在「物料真的定下来」时才写
     * （选中物料 / 清空物料 / 打开详情），正好是应该重查的时机。
     *
     * 重查时**把旧的「特性」清掉**：那是上一个物料的组合，留着它再点一次保存，
     * 会把包装方法 / 项目 / 缝制物料全填成上一个物料的（比空格更难发现）。
     */
    useEffect(() => {
        if (!open) {
            // 关掉就把「上次查过谁」忘掉：再打开时即使还是同一份记录也要重查（档案可能变过）
            featureVIDRef.current = null;
            return;
        }
        if (featureVIDRef.current === materialVID) return;
        featureVIDRef.current = materialVID;
        const seq = ++featureSeqRef.current;
        form.setFieldsValue({Feature: undefined});
        /*
         * 查的时候仍然用**编码**（`features` 接口的参数），但触发只看 VID：
         * 历史数据里可能只有编码没有 VID，所以这里不把 VID 当必要条件 —— 打开时
         * 编码有值就查一次，够用了。
         */
        const code = toStringOrEmpty(form.getFieldValue('MaterialCode')).trim();
        if (!code) {
            setFeatures([]);
            setFeaturesLoading(false);
            return;
        }
        setFeaturesLoading(true);
        void processRouteMatrixApi.features(code)
            .then((result) => {
                if (seq !== featureSeqRef.current) return;
                setFeatures(result.data ?? []);
            })
            .catch(() => {
                if (seq !== featureSeqRef.current) return;
                /*
                 * 查不到不等于出错，只是这个物料在包装 BOM 里还没有组合：
                 * 清空候选、让用户手填，别把「查不到」弹成错误挡住改单。
                 */
                setFeatures([]);
            })
            .finally(() => {
                if (seq === featureSeqRef.current) setFeaturesLoading(false);
            });
    }, [open, materialVID, form]);

    /**
     * 候选回来后，把当前这份矩阵对应的「特性」显示出来。
     *
     * 矩阵头上**没有** Feature 字段（它是从包装 BOM 推出来的组合，不是矩阵自己的数据），
     * 所以编辑打开时那一格是空的。按「项目 + 包装方法 + 包装数量」在候选里对一条填回去 ——
     * 用户一眼就知道这份矩阵挂的是哪个组合，不用自己逐项比对。
     */
    useEffect(() => {
        if (!open) return;
        if (features.length === 0) return;
        if (toStringOrEmpty(form.getFieldValue('Feature')) !== '') return;
        const pick = features.find((item) =>
            item.PackMethod === toStringOrEmpty(form.getFieldValue('PackMethod'))
            && item.PackNum === toStringOrEmpty(form.getFieldValue('PackNum'))
            && item.ProjectCode === toStringOrEmpty(form.getFieldValue('ProjectCode')),
        );
        if (pick) form.setFieldsValue({Feature: pick.Feature});
    }, [open, features, form]);

    /**
     * 选中一个特性：把这一组字段**整套复制**到表单（也就是 `matrix` 里对应的那几个字段）。
     *
     * 复制的正是 features 查出来的那几列：`PackMethod` / `PackNum` / `ProjectCode` /
     * `ProjectID` / `SewMaterialVID` —— 它们合起来就是这条工艺路线要挂的 BOM 组合。
     *
     * 缝制物料只拿到 VID 不够用（界面上要显示编码 / 名称 / 单位），所以顺手按 VID
     * 回查一次档案（`loadArchive`，与「手动选缝制物料」走同一条路）。
     *
     * 清空下拉时**只清「特性」这一格**：别的字段可能是用户自己填的，不替他一并清掉。
     */
    const applyFeature = useCallback((feature: string) => {
        const pick = features.find((item) => item.Feature === feature);
        if (!pick) {
            form.setFieldsValue({Feature: undefined});
            return;
        }
        form.setFieldsValue({
            Feature: pick.Feature,
            PackMethod: pick.PackMethod,
            PackNum: pick.PackNum,
            ProjectCode: pick.ProjectCode,
            ProjectID: pick.ProjectID,
            SewMaterialVID: pick.SewMaterialVID,
        });
        void loadArchive('sew', pick.SewMaterialVID, '');
    }, [features, form, loadArchive]);

    /**
     * 下拉选项：`value` 与 `label` 都用 `Feature`（`项目_包装方法_包装数量`，本身就是人看的组合）。
     *
     * 按 `Feature` 去重、只留第一条：接口是按「包装方法 + 数量 + 项目 + 缝制物料」分组的，
     * 同一个 `Feature` 理论上可能对上多条（缝制物料不同）。不去重的话下拉里会出现两个
     * 一模一样的选项 —— 用户选哪个都以为是同一个，实际落的是不同缝制物料。
     */
    const featureOptions = useMemo(() => {
        const seen = new Set<string>();
        return features
            .filter((item) => {
                if (!item.Feature || seen.has(item.Feature)) return false;
                seen.add(item.Feature);
                return true;
            })
            .map((item) => ({value: item.Feature, label: item.Feature}));
    }, [features]);

    /*
     * 打开时：表单先按底稿填一遍，再去取详情与两份物料档案。
     *
     * 关闭 / 换记录时作废在飞的请求 —— 不挡的话「打开 A 又立刻换 B」会把 A 的详情
     * 写进 B 的界面。放在 cleanup 里而不是 effect 开头，是为了不在渲染副作用里做多余的事。
     */
    useEffect(() => {
        if (!open) return;
        form.setFieldsValue((record ?? {}) as Record<string, unknown>);
        const id = toStringOrEmpty(record?.ProcessRouteMatrixID);
        if (id) void loadDetail(id);
        /*
         * 档案回查跟着底稿走（不是等详情）：列表行本来就有编码 / VID，
         * 先把版本 / 规格 / 型号填上，用户不必等一趟详情才能看出这是哪个物料。
         */
        void loadArchive('pack', toStringOrEmpty(record?.MaterialVID), toStringOrEmpty(record?.MaterialCode));
        void loadArchive('sew', toStringOrEmpty(record?.SewMaterialVID), '');
        return () => {
            seqRef.current += 1;
            archiveSeqRef.current += 1;
        };
    }, [open, record, form, loadDetail, loadArchive]);

    /**
     * 渲染一个字段的控件。
     *
     * 五种形态（前四种与包装 BOM 的表单一致）：
     * - 物料编码：`MaterialSelect`（输入编码查库 / 弹窗里挑，选完带出整组属性）；
     * - 单位：`ConvertSelect`（候选是这个物料的换算单位，选完带出换算率）；
     * - 项目：`ProjectSelect`（输入项目号查库，选完带出项目主键）；
     * - 特性：`Select`（候选来自**包装 BOM 里这个物料已有的组合**，选中后整套字段一起填）；
     * - 其余：普通输入框，只读字段禁用（值由物料带出）。
     */
    const renderControl = useCallback((field: ProcessRouteFormField) => {
        if (field.material) {
            const isSew = field.material === 'sew';
            return (
                <MaterialSelect
                    disabled={!isEditable}
                    onSelect={isSew ? applySewMaterial : applyMaterial}
                    // 清空物料时把名称 / 版本 / 单位这些一起清掉，别留下半截数据
                    onClear={isSew ? clearSewMaterial : clearMaterial}
                    // 与包装 BOM 同一口径：包装成品 4 开头、产成品 3 开头
                    filter={isSew ? ['3'] : ['4']}
                />
            );
        }
        if (field.convert) {
            const isSew = field.convert === 'sew';
            return (
                <ConvertSelect
                    disabled={!isEditable || isSew}
                    materialVID={isSew ? sewMaterialVID : materialVID}
                    onSelect={isSew ? applySewConvert : applyConvert}
                />
            );
        }
        if (field.project) {
            return <ProjectSelect disabled={!isEditable} onSelect={applyProject} onClear={clearProject}/>;
        }
        if (field.feature) {
            return (
                <Select
                    allowClear
                    showSearch
                    optionFilterProp={'label'}
                    loading={featuresLoading}
                    // 没选包装物料就没有候选：禁用并说清楚，别给一个空下拉让人猜
                    disabled={!isEditable || materialCode.trim() === ''}
                    placeholder={materialCode.trim() === '' ? '先选包装物料' : '选择包装 BOM 里的组合'}
                    options={featureOptions}
                    /*
                     * 这里自己写回表单（Form.Item 注入的 onChange 会被覆盖）：
                     * 选中一个特性不只是改一格，而是把包装方法 / 数量 / 项目 / 缝制物料
                     * 整套带出来，见 `applyFeature`。清空（allowClear → undefined）同理。
                     */
                    onChange={(value) => applyFeature(toStringOrEmpty(value))}
                />
            );
        }
        return <Input disabled={field.readOnly || !isEditable}/>;
    }, [
        isEditable, applyMaterial, applySewMaterial, clearMaterial, clearSewMaterial,
        materialVID, sewMaterialVID, applyConvert, applySewConvert, applyProject, clearProject,
        featuresLoading, materialCode, featureOptions, applyFeature,
    ]);

    /**
     * 保存的一次尝试。
     *
     * 明细取**表格里的行**（`readRows('items')`，含未落库的增删改）：
     * 拿 `baseRecord.Detail` 拼等于把用户刚才的改动丢掉。
     *
     * 之所以单独一层（而不是全写在按钮的 onClick 里）：界面上的「保存」与 agent 的
     * `form.submit` 必须走**同一条路**，只是前者把原因弹成框、后者把原因塞进回执。
     * 两边各写一份迟早对不上（界面改了校验、桥那边还按老规则回「已保存」）。
     */
    const performSave = useCallback(async (): Promise<SaveOutcome> => {
        if (saving) return {ok: false, message: '正在保存中：等这一次回来再操作（重复提交会存两份）'};
        const values = form.getFieldsValue() as Record<string, unknown>;
        const detail = matrixRef.current?.readRows('items') ?? (baseRecord.Detail ?? []);
        const issues = validateProcessRouteMatrix({
            materialCode: values.MaterialCode,
            // 缝制物料只拿到编码也认（历史数据可能没有 VID）
            sewMaterial: values.SewMaterialVID || values.SewMaterialCode,
            detail,
        });
        // 校验不过：把条目原样交出去，弹框与回执各自按自己的方式呈现
        if (issues.length > 0) return {ok: false, message: issues.join('；'), issues};

        const payload = buildProcessRouteMatrix({
            mode, base: baseRecord, values, detail, matrixID: recordID,
        });

        setSaving(true);
        try {
            const saved = await processRouteMatrixApi.save(payload);
            const savedID = toStringOrEmpty(saved.data?.ProcessRouteMatrixID) || recordID;
            if (!savedID) {
                // 存进去了却没回主键：没法重取、没法继续编辑 / 发布，如实说，别当成功
                return {
                    ok: false,
                    message: '保存已提交，但接口没有返回 ProcessRouteMatrixID，无法重新载入这份矩阵（请刷新列表确认）',
                };
            }
            setRecordID(savedID);
            void message.success('已保存');
            // 重取详情：接口补上明细主键与矩阵版本之后，这份记录才能接着改 / 发布
            await loadDetail(savedID);
            onSaved?.(savedID);
            const rowCount = payload.Detail?.length ?? 0;
            return {
                ok: true,
                message: `已保存（ProcessRouteMatrixID ${savedID}；工序明细 ${rowCount} 行），弹窗已按新主键重新载入，可以接着改`,
            };
        } catch (err) {
            const text = ErrorMessage(err, '保存失败');
            void message.error(text);
            return {ok: false, message: text};
        } finally {
            setSaving(false);
        }
    }, [saving, form, baseRecord, mode, recordID, message, loadDetail, onSaved]);

    /** 界面上的「保存」：成功什么都不用做（toast 已经在里面），校验不过逐条列出来 */
    const handleSave = useCallback(async () => {
        const outcome = await performSave();
        if (outcome.ok) return;
        // 只有「校验不过」才值得弹列表；接口失败已经 toast 过，再弹一个框只是噪音
        if (!outcome.issues || outcome.issues.length === 0) return;
        modal.warning({
            title: '还不能保存',
            width: 460,
            content: (
                <ul style={{margin: '8px 0 0', paddingLeft: 20}}>
                    {outcome.issues.map((text) => <li key={text}>{text}</li>)}
                </ul>
            ),
            okText: '知道了',
        });
    }, [performSave, modal]);

    /**
     * 某个字段此刻为什么改不了（null = 可以改）。
     *
     * **锁的唯一真相在这里**：界面上的 `disabled` 与界面桥的 `fieldLock` 读同一份判断 ——
     * 桥那边再推一遍「查看模式只读 / 详情没到别改」必然与界面漂移。
     */
    const fieldLock = useCallback((fieldId: string): string | null => {
        if (!isEditable) return '当前是查看模式：整张表单只读';
        if (loadingDetail) return '矩阵详情还在加载：加载完会整体覆盖一次，改了也留不住';
        // 特性下拉在没选包装物料时是禁用的（候选来自包装 BOM，没有物料就没有候选）
        if (fieldId === 'Feature' && materialCode.trim() === '') {
            return '还没有包装物料编码：特性候选来自包装 BOM，先设 MaterialCode';
        }
        return null;
    }, [isEditable, loadingDetail, materialCode]);

    /**
     * 按分组把物料属性带出来（界面桥写物料编码时走这里）。
     *
     * 就是用户在选择器里选中物料的同一条路 —— 产成品还会重取特性候选，
     * 桥要是自己回填那几个字段，这一整套副作用就漏了。
     */
    const applyMaterialByGroup = useCallback((group: ProcessRouteFieldGroup, material: NCMaterial) => {
        if (group === 'sew') applySewMaterial(material);
        else applyMaterial(material);
    }, [applySewMaterial, applyMaterial]);

    /** 按分组写「单位 + 换算率」（与界面上选单位同一条路） */
    const applyConvertByGroup = useCallback((group: ProcessRouteFieldGroup, convert: NCMaterialConvert) => {
        if (group === 'sew') applySewConvert(convert);
        else applyConvert(convert);
    }, [applySewConvert, applyConvert]);

    /**
     * 工序明细此刻为什么不能编（null = 能编）。
     *
     * 判据与界面上的「蒙层」同一条（`canEditItems`）：查看模式恒不能；其余模式要求先选产成品。
     * 桥若自己另算一遍，就会出现「界面上蒙着、agent 却能改」。
     */
    const itemsEditLock = useCallback((): string | null => {
        if (!isEditable) return '当前是查看模式：工序明细只读';
        if (!hasSewMaterial) return '还没选产成品物料：先 form.set SewMaterialCode（它决定工序明细能不能编）';
        return null;
    }, [isEditable, hasSewMaterial]);

    /** 特性候选的**值**（界面上下拉用 {value,label}，桥只认值） */
    const featureValues = useCallback(() => featureOptions.map((item) => item.value), [featureOptions]);

    /** 工序明细的当前行（含未保存的编辑与末尾那行等输入的空行） */
    const readItems = useCallback(() => matrixRef.current?.readRows('items') ?? [], []);
    /** 工序明细的行级写能力（详情没到 / 表格没渲染时是 null） */
    const readItemsGrid = useCallback(() => matrixRef.current?.readGrid('items') ?? null, []);

    /** 详情落地没有：界面桥的 `ready`、读与写的前置条件都问它 */
    const detailReady = useCallback(() => !loadingDetail, [loadingDetail]);

    /**
     * 交给弹窗桥的状态与能力：字段表、动作表、提交语义都在 `./processRouteMatrixEditBridge`。
     *
     * 传取值函数而不是对象本身 —— 桥在 snapshot / 命令执行的那一刻才读，
     * 所以宿主不必跟着每次渲染重建。
     */
    const bridgeContext = useMemo<ProcessRouteEditBridgeContext>(() => ({
        title: hasRecord && (mode === 'add' || mode === 'copy') ? EDIT_TITLE : MODE_TITLE[mode],
        mode,
        recordId: recordID || null,
        form,
        isReady: detailReady,
        fieldLock,
        applyMaterial: applyMaterialByGroup,
        applyConvert: applyConvertByGroup,
        applyProject,
        applyFeature,
        featureOptions: featureValues,
        matrix: baseRecord,
        activeKey,
        setActiveKey,
        readRows: readItems,
        readGrid: readItemsGrid,
        itemsEditLock,
        submit: performSave,
        close: onClose,
    }), [
        mode, recordID, hasRecord, form, detailReady, fieldLock, applyMaterialByGroup, applyConvertByGroup,
        applyProject, applyFeature, featureValues, baseRecord, activeKey, readItems, readItemsGrid,
        itemsEditLock, performSave, onClose,
    ]);

    const dialogBridge = useMemo(
        () => createProcessRouteEditBridge(() => bridgeContext),
        [bridgeContext],
    );
    /*
     * 弹窗自己注册到界面桥：打开期间顶掉页面的工具栏动作、查询条件与列表数据，guide 也换成表单那份；
     * 关闭后自动让位 —— 覆盖规则由桥统一实现，见 ui-bridge/handler.ts 的 composeSnapshot。
     */
    useUIBridgeDialog(view, dialogBridge, open);

    const matrixLabel = matrixLabelOf(baseRecord);

    return (
        <>
            <Modal
                open={open}
                /*
                 * 保存成功后这份矩阵已经有身份了，标题跟着改成「编辑」——
                 * 否则用户明明在改一份已落库的记录，标题却还写着「新增」。
                 */
                title={hasRecord && (mode === 'add' || mode === 'copy') ? EDIT_TITLE : MODE_TITLE[mode]}
                width={'80%'}
                onCancel={onClose}
                // 没有底部按钮：保存 / 发布在顶部工具栏（与原界面一致）
                footer={null}
                // 关闭即销毁：换一份记录再打开时表单与表格都从干净的实例开始
                destroyOnHidden
                className="process-matrix-edit"
                mask={{
                    closable: false,
                    blur: true,
                }}
            >
                <div className="process-matrix-edit-toolbar">
                    <Button type="text" className="process-matrix-edit-action" icon={<SaveOutlined/>}
                            loading={saving} disabled={saving || !isEditable}
                            onClick={() => void handleSave()}>保存</Button>
                    {/*
                     * 分割线：「保存」是对这一份的直接操作；「发布」要按**已落库**的记录做事，
                     * 线一划，两组的分界就看得出来了。
                     */}
                    <Divider orientation="vertical" className="process-matrix-edit-divider"/>
                    <Button type="text" className="process-matrix-edit-action" icon={<CloudUploadOutlined/>}
                            disabled={!hasRecord}
                            title={hasRecord ? undefined : '保存成功后（拿到矩阵主键）才可用'}
                            onClick={() => setPushOpen(true)}>发布</Button>
                </div>

                <Form
                    form={form}
                    // 编辑 / 复制把底稿带出来（复制也带，只是保存时不带主键）；
                    // 详情到达后由 `loadDetail` 补齐（initialValues 只管首帧）
                    initialValues={(record ?? {}) as Record<string, unknown>}
                    layout="horizontal"
                    labelCol={{flex: '72px'}}
                    colon={false}
                    size="small"
                >
                    {/*
                     * 隐藏字段：界面上没有入口，但它们必须注册成 Form.Item ——
                     * `form.getFieldsValue()` 只含**已注册**的字段，只靠 `setFieldsValue`
                     * 塞进去的键在保存装配时读不到，主键会静默丢失。
                     * `MaterialVID` / `SewMaterialVID` 还得能被 `Form.useWatch` 看到（单位选择器要）。
                     */}
                    <Form.Item name="MaterialVID" hidden><Input/></Form.Item>
                    <Form.Item name="CMeasureid" hidden><Input/></Form.Item>
                    <Form.Item name="Cassmeasureid" hidden><Input/></Form.Item>
                    <Form.Item name="ProjectID" hidden><Input/></Form.Item>
                    <Form.Item name="SewMaterialVID" hidden><Input/></Form.Item>

                    {/*
                     * 两组主物料：包装成品 → 产成品（与包装 BOM 的表单同一顺序、同一组字段）。
                     * 组内的字段由 `PACK_FIELDS` / `SEW_FIELDS` 驱动，少写一个字段界面上也就少一个。
                     */}
                    {(['pack', 'sew'] as const).map((group) => (
                        <section className="process-matrix-group" key={group}>
                            <div className="process-matrix-group-title">{GROUP_TITLE[group]}</div>
                            <div className="process-matrix-fields">
                                {(group === 'pack' ? PACK_FIELDS : SEW_FIELDS).map((field) => (
                                    <Form.Item
                                        key={field.id}
                                        name={field.id}
                                        label={field.label}
                                        /*
                                         * 特性单独占一行：它的内容是「项目_包装方法_包装数量」
                                         * 拼出来的长串，挤在 220px 的格子里只能看到前半截。
                                         * 样式见 `processRouteMatrixEdit.css` 的同名类。
                                         */
                                        className={field.feature ? 'process-matrix-field-wide' : undefined}
                                    >
                                        {renderControl(field)}
                                    </Form.Item>
                                ))}
                            </div>
                        </section>
                    ))}
                </Form>

                {/*
                 * 下半部分：编辑态的工序明细。
                 * 详情没到之前**不渲染表格**：拿列表摘要（没有 Detail）铺出来是一张空表，
                 * 详情一到整块重铺 —— 空行、选中、滚动全部闪一遍。占位块与表格同高，弹窗不会跳。
                 *
                 * 缝制物料没选时整块禁用（蒙一层说明）：工序明细是**这个缝制物料的**工艺路线，
                 * 先录明细再选缝制物料，等于把行挂到空气上 —— 与包装 BOM 的「产成品没选 →
                 * 子项明细禁用」同一个处理。
                 */}
                <div className="process-matrix-edit-table">
                    {loadingDetail ? (
                        <div className="process-matrix-edit-loading">
                            <Spin/>
                            <span>正在加载矩阵详情…</span>
                        </div>
                    ) : (
                        <>
                            <ProcessRouteMatrixView
                                ref={matrixRef}
                                matrix={baseRecord}
                                isEditMode={canEditItems}
                                activeKey={activeKey}
                                onActiveKeyChange={setActiveKey}
                            />
                            {!canEditItems && (
                                <div className="process-matrix-edit-mask">
                                    {isEditable ? '请先选择缝制物料，再编辑工序明细' : '只读查看'}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </Modal>
            {/* 发布弹窗：与页面命令条的「发布」是同一个通用组件（`components/nc/matrixPushModal`） */}
            <MatrixPushModal open={pushOpen}
                             title={'工艺路线矩阵明细'}
                             matrixID={recordID}
                             matrixLabel={matrixLabel}
                             RuleKeyField={'ProcessRouteMatrixRuleID'}
                             VersionField={'PRVersion'}
                             VersionFieldName={'工艺版本'}
                             api={PUSH_API}
                             onClose={() => setPushOpen(false)}/>
        </>
    );
};

export default ProcessRouteMatrixEdit;
