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

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {App, Button, Divider, Form, Input, Modal, Spin} from 'antd';
import {CloudUploadOutlined, SaveOutlined} from '@ant-design/icons';
import {
    ProcessRouteMatrixView,
    type ProcessRouteMatrixViewApi,
} from '@/components/nc/processRouteMatrix';
import {DEFAULT_PROCESS_ROUTE_SECTION} from '@/components/nc/processRouteMatrix/sections.ts';
import MaterialSelect from '@/components/nc/materialSelect.tsx';
import ConvertSelect from '@/components/nc/convertSelect.tsx';
import ProjectSelect from '@/components/nc/projectSelect.tsx';
import {putConverts} from '@/components/nc/convertCache.ts';
import MatrixPushModal, {type MatrixPushApi} from '@/components/nc/matrixPushModal.tsx';
import type {NCMaterial, NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import type {NCProject} from '@/api/schemas/nc/NCBase.ts';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import {processRouteMatrixApi} from '@/api/modules/nc/processRouteMatrix.ts';
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import {ErrorMessage} from '@/api/request.ts';
import {isBlank, toStringOrEmpty} from '@/utils';
import {buildProcessRouteMatrix} from './processRouteMatrixPayload.ts';
import {validateProcessRouteMatrix} from './processRouteMatrixValidation.ts';
import type {FormMode} from '../command';
import './processRouteMatrixEdit.css';

export type ProcessRouteMatrixEditProps = {
    open: boolean;
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
type FormGroup = 'pack' | 'sew';

const GROUP_TITLE: Record<FormGroup, string> = {
    pack: '包装成品',
    sew: '产成品',
};

/** 字段的控件形态：物料选择器 / 单位选择器 / 项目选择器 / 普通输入框 */
type FormField = {
    /** 字段 id，就是 Form.Item 的 name */
    id: string;
    /** 界面上的标签（分组标题已经说明了它属于谁，所以两组都有「物料编码 / 单位」） */
    label: string;
    group: FormGroup;
    /** 只读：值由物料带出，手填会出现自相矛盾的数据 */
    readOnly?: boolean;
    kind?: 'material' | 'convert' | 'project';
};

/**
 * 包装成品那一组（界面上的第一组）。
 *
 * 与包装 BOM 的 `PACK_FIELDS` 一一对应，字段名换成工艺矩阵的 `MaterialXXX`。
 * 少写一个字段，界面上也就少一个 —— 这里就是「上一半」的清单。
 */
const PACK_FIELDS: FormField[] = [
    {id: 'MaterialCode', label: '物料编码', group: 'pack', kind: 'material'},
    {id: 'MaterialName', label: '物料名称', group: 'pack', readOnly: true},
    {id: 'MaterialVersion', label: '物料版本', group: 'pack', readOnly: true},
    {id: 'MaterialSpec', label: '物料规格', group: 'pack', readOnly: true},
    {id: 'MaterialModel', label: '物料型号', group: 'pack', readOnly: true},
    {id: 'CMeasure', label: '主单位', group: 'pack', readOnly: true},
    {id: 'VChangerate', label: '转换率', group: 'pack', readOnly: true},
    {id: 'Cassmeasure', label: '单位', group: 'pack', kind: 'convert'},
    {id: 'PackMethod', label: '包装方法', group: 'pack'},
    {id: 'PackNum', label: '包装数量', group: 'pack'},
    {id: 'ProjectCode', label: '项目', group: 'pack', kind: 'project'},
];

/**
 * 产成品（缝制物料）那一组。
 *
 * 「物料编码」是这一组唯一的编辑入口；`SewMaterialVID` 是隐藏的关联键，不入表 ——
 * 让用户手填 VID 只会填出脏数据。
 */
const SEW_FIELDS: FormField[] = [
    {id: 'SewMaterialCode', label: '物料编码', group: 'sew', kind: 'material'},
    {id: 'SewMaterialName', label: '物料名称', group: 'sew', readOnly: true},
    {id: 'SewMaterialVersion', label: '物料版本', group: 'sew', readOnly: true},
    {id: 'SewMaterialSpec', label: '物料规格', group: 'sew', readOnly: true},
    {id: 'SewMaterialModel', label: '物料型号', group: 'sew', readOnly: true},
    {id: 'SewCMeasure', label: '主单位', group: 'sew', readOnly: true},
    {id: 'SewVChangerate', label: '转换率', group: 'sew', readOnly: true},
    {id: 'SewCassmeasure', label: '单位', group: 'sew', kind: 'convert'},
];

/** 标题旁那一行「是哪一份矩阵」：物料编码 + 名称 */
function matrixLabelOf(matrix: ProcessRouteMatrix): string {
    const parts = [toStringOrEmpty(matrix.MaterialCode), toStringOrEmpty(matrix.MaterialName)]
        .map((text) => text.trim())
        .filter((text) => text !== '');
    return parts.join(' ');
}

const ProcessRouteMatrixEdit: React.FC<ProcessRouteMatrixEditProps> = ({
    open, mode, record, onSaved, onClose,
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

    /**
     * 两个物料的主键：单位选择器的候选单位按它取。
     *
     * 用 `Form.useWatch` 而不是直接读 ref：`MaterialVID` / `SewMaterialVID` 都注册成了
     * 隐藏的 `Form.Item`（`useWatch` 只看**已注册字段**），所以物料一变这里就跟着变。
     */
    const materialVID = toStringOrEmpty(Form.useWatch('MaterialVID', form));
    const sewMaterialVID = toStringOrEmpty(Form.useWatch('SewMaterialVID', form));

    /**
     * 请求序号：关掉弹窗 / 换一份记录时，让在飞的详情请求作废。
     * 不挡的话「打开 A 又立刻换 B」会把 A 的详情写进 B 的界面。
     */
    const seqRef = useRef(0);
    /** 物料档案回查的序号：重试 / 换底稿时只认最后一次的结果 */
    const archiveSeqRef = useRef(0);

    const hasRecord = recordID !== '';
    const isEditable = mode !== 'view';

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
    const applyMaterial = useCallback((material: NCMaterial, options?: {keepUnits?: boolean}) => {
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
    const applySewMaterial = useCallback((material: NCMaterial, options?: {keepUnits?: boolean}) => {
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
    const loadArchive = useCallback(async (group: FormGroup, vid: string, code: string) => {
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
            else applySewMaterial(material, {keepUnits: true});
        } catch {
            // 档案查失败不影响改单：名称 / 单位照旧从详情带出来，保存以编码为准
        }
    }, [applyMaterial, applySewMaterial]);

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
     * 四种形态与包装 BOM 的表单一致：
     * - 物料编码：`MaterialSelect`（输入编码查库 / 弹窗里挑，选完带出整组属性）；
     * - 单位：`ConvertSelect`（候选是这个物料的换算单位，选完带出换算率）；
     * - 项目：`ProjectSelect`（输入项目号查库，选完带出项目主键）；
     * - 其余：普通输入框，只读字段禁用（值由物料带出）。
     */
    const renderControl = useCallback((field: FormField) => {
        if (field.kind === 'material') {
            const isSew = field.group === 'sew';
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
        if (field.kind === 'convert') {
            const isSew = field.group === 'sew';
            return (
                <ConvertSelect
                    disabled={!isEditable}
                    materialVID={isSew ? sewMaterialVID : materialVID}
                    onSelect={isSew ? applySewConvert : applyConvert}
                />
            );
        }
        if (field.kind === 'project') {
            return <ProjectSelect disabled={!isEditable} onSelect={applyProject} onClear={clearProject}/>;
        }
        return <Input disabled={field.readOnly || !isEditable}/>;
    }, [
        isEditable, applyMaterial, applySewMaterial, clearMaterial, clearSewMaterial,
        materialVID, sewMaterialVID, applyConvert, applySewConvert, applyProject, clearProject,
    ]);

    /**
     * 保存。
     *
     * 明细取**表格里的行**（`readRows('items')`，含未落库的增删改）：
     * 拿 `baseRecord.Detail` 拼等于把用户刚才的改动丢掉。
     */
    const handleSave = useCallback(async () => {
        if (saving) return;
        const values = form.getFieldsValue() as Record<string, unknown>;
        const detail = matrixRef.current?.readRows('items') ?? (baseRecord.Detail ?? []);
        const issues = validateProcessRouteMatrix({materialCode: values.MaterialCode, detail});
        if (issues.length > 0) {
            modal.warning({
                title: '还不能保存',
                width: 460,
                content: (
                    <ul style={{margin: '8px 0 0', paddingLeft: 20}}>
                        {issues.map((text) => <li key={text}>{text}</li>)}
                    </ul>
                ),
                okText: '知道了',
            });
            return;
        }

        const payload = buildProcessRouteMatrix({
            mode, base: baseRecord, values, detail, matrixID: recordID,
        });

        setSaving(true);
        try {
            const saved = await processRouteMatrixApi.save(payload);
            const savedID = toStringOrEmpty(saved.data?.ProcessRouteMatrixID) || recordID;
            if (savedID) setRecordID(savedID);
            void message.success('已保存');
            // 重取详情：接口补上明细主键与矩阵版本之后，这份记录才能接着改 / 发布
            if (savedID) await loadDetail(savedID);
            onSaved?.(savedID);
        } catch (err) {
            void message.error(ErrorMessage(err, '保存失败'));
        } finally {
            setSaving(false);
        }
    }, [saving, form, baseRecord, mode, recordID, modal, message, loadDetail, onSaved]);

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
                                    <Form.Item key={field.id} name={field.id} label={field.label}>
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
                 */}
                <div className="process-matrix-edit-table">
                    {loadingDetail ? (
                        <div className="process-matrix-edit-loading">
                            <Spin/>
                            <span>正在加载矩阵详情…</span>
                        </div>
                    ) : (
                        <ProcessRouteMatrixView
                            ref={matrixRef}
                            matrix={baseRecord}
                            isEditMode={isEditable}
                            activeKey={activeKey}
                            onActiveKeyChange={setActiveKey}
                        />
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
