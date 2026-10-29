import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";
import {BomMatrixView, type BomMatrixViewApi} from "@/components/nc/bomMatrix";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {Button} from "antd";
import NCMaterialModal from "@/components/nc/materialModal.tsx";
import NCProductorModal from "@/components/nc/productorModal.tsx";
import {DEFAULT_BOM_MATRIX_SECTION, type BomMatrixSection} from "@/components/nc/bomMatrix/sections.ts";
import {useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {createBomMatrixBridge, type BomMatrixBridgeContext} from "./bridged";

/**
 * V0277_V0354 包装 BOM 矩阵
 *
 * 界面桥的声明全在 `./bridged.ts`（guide、三张表怎么拼、切标签页）：**那个文件存在本身就是
 * 「本页接入了界面桥」的标记**，工作台的导航清单靠它判定。所以本文件里没有桥的细节，
 * 只有「把当前状态交出去」这一句，以及一个受控的 activeKey。
 */
const NCPackBomMatrixPage: React.FC<ViewPageProps> = ({view, trail}) => {

    const [bomMatrix, setBomMatrix] = useState<BomMatrix>({});
    /** 详情接口回来没有（成功失败都算）—— 桥的 `ready` 读它，见 `./bridged` 的 `isReady` */
    const [loaded, setLoaded] = useState<boolean>(false);
    const [openModal, setOpenModal] = useState<boolean>(false);
    const [openModal2, setOpenModal2] = useState<boolean>(false);

    /**
     * 当前标签页。**放在页面上而不是控件里**：界面桥必须如实回答「用户在看哪一张表」，
     * 控件内部再存一份就会和屏幕上分叉（详见 BomMatrixView 的 activeKey 注释）。
     */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_BOM_MATRIX_SECTION);
    /** 控件交出的读能力：三个表格实例都在它里面，桥按标签页名取 */
    const matrixRef = useRef<BomMatrixViewApi | null>(null);

    useEffect(() => {
        packBomMatrixApi.detail("241C0A56-B08C-4E41-867D-AEECBA89E851").then((res) => {
            console.log(res);
            setBomMatrix(res.data ?? {});
        }).catch((error) => {
            // 失败也置 ready：否则桥的 ready() 永远 false，导航每次都要等到超时
            console.error('加载包装 BOM 矩阵失败', error);
        }).finally(() => {
            setLoaded(true);
        });
    }, []);

    /** 交给桥的就绪判断：只看「接口回来没有」，不看内容（内容为空也是一份合法的快照） */
    const isReady = useCallback(() => loaded, [loaded]);

    /**
     * 取某张表的实例（`() => matrixRef.current?.readTable(key)`）。
     *
     * 桥要的是取值函数而不是快照：表格实例会随标签页挂载/卸载而变，
     * 「此刻有没有」只有调用那一刻才作数 —— 这也是 `readable` 的唯一数据来源。
     */
    const readTable = useCallback(
        (section: BomMatrixSection) => matrixRef.current?.readTable(section) ?? null,
        [],
    );

    /** 交给桥的状态与能力：桥通过取值函数读它，不直接持有 */
    const bridgeContext = useMemo<BomMatrixBridgeContext>(
        () => ({view, bomMatrix, activeKey, readTable, setActiveKey, isReady}),
        [view, bomMatrix, activeKey, readTable, isReady],
    );

    /**
     * 界面桥：三张表的目录 + 切标签页。
     *
     * 依赖里的 `bomMatrix` 是必须的 —— 配色/配码的列跟着尺码/颜色表走，列变了就得重建宿主
     * （列目录变了本来就该发整页快照，桥会自己判定）。
     */
    const bridge = useMemo(() => createBomMatrixBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Button onClick={() => {
                setOpenModal(true);
            }}>点击物料</Button>
            <Button onClick={() => {
                setOpenModal2(true);
            }}>点击单位</Button>
            <BomMatrixView ref={matrixRef} bomMatrix={bomMatrix}
                           activeKey={activeKey} onActiveKeyChange={setActiveKey}/>
            <NCMaterialModal open={openModal} onCancel={() => setOpenModal(false)}
                             onSelect={(material, activeRow) => {
                                 console.log("物料", material);
                                 console.log(activeRow);
                             }}/>

            <NCProductorModal open={openModal2} onCancel={() => setOpenModal2(false)}
                              onSelect={(material, activeRow) => {
                                  console.log("生产厂商", material);
                                  console.log(activeRow);
                              }}/>
        </div>
    );
}

export default NCPackBomMatrixPage;
