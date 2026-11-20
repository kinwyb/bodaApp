import React from 'react';
import {Card, Empty, Flex, Spin, Typography} from 'antd';
import machineImage from './assets/machine.png';
import type {MachineScheduleRow} from './schedule';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0122");


type MachineTilesProps = {
    rows: MachineScheduleRow[];
    loading: boolean;
};

function shiftText(shift: string, name: string): string {
    return [shift, name].filter(Boolean).join(' ');
}

const MachineTiles: React.FC<MachineTilesProps> = ({rows, loading}) => {
    return (
        <Spin spinning={loading} style={{height: '100%'}}>
            <div style={{height: '100%', overflow: 'auto', padding: 2}}>
                {rows.length === 0 ? (
                    <Flex align="center" justify="center" style={{height: '100%'}}>
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有任何记录")}/>
                    </Flex>
                ) : (
                    <Flex wrap gap={6} align="flex-start">
                        {rows.map((machine) => (
                            <Card
                                key={machine.MachCode}
                                size="small"
                                hoverable
                                styles={{body: {height: '100%', padding: 6}}}
                                style={{width: 130, height: 156, flex: '0 0 130px'}}
                            >
                                <Flex vertical align="center" style={{height: '100%', position: 'relative'}}>
                                    {machine.PlantCode ? (
                                        <Typography.Text
                                            type="danger"
                                            ellipsis
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                right: 0,
                                                maxWidth: 72,
                                                fontSize: 12,
                                            }}
                                        >
                                            {machine.PlantCode}
                                        </Typography.Text>
                                    ) : null}
                                    <img
                                        src={machineImage}
                                        alt=""
                                        style={{
                                            display: 'block',
                                            width: 54,
                                            height: 54,
                                            marginTop: 2,
                                            objectFit: 'contain',
                                        }}
                                    />
                                    <div style={{
                                        minWidth: 64,
                                        marginTop: 5,
                                        padding: '1px 8px',
                                        background: '#ff9900',
                                        color: '#fff',
                                        fontSize: 16,
                                        fontWeight: 600,
                                        lineHeight: '19px',
                                        textAlign: 'center',
                                    }}>
                                        {machine.MachCode}
                                    </div>
                                    <Flex vertical gap={3} style={{width: '100%', marginTop: 9}}>
                                        {shiftText(machine.Shift1, machine.Shift1Name) ? (
                                            <Typography.Text ellipsis style={{fontSize: 13}}>
                                                {shiftText(machine.Shift1, machine.Shift1Name)}
                                            </Typography.Text>
                                        ) : null}
                                        {shiftText(machine.Shift2, machine.Shift2Name) ? (
                                            <Typography.Text ellipsis style={{fontSize: 13}}>
                                                {shiftText(machine.Shift2, machine.Shift2Name)}
                                            </Typography.Text>
                                        ) : null}
                                        {shiftText(machine.Shift3, machine.Shift3Name) ? (
                                            <Typography.Text ellipsis style={{fontSize: 13}}>
                                                {shiftText(machine.Shift3, machine.Shift3Name)}
                                            </Typography.Text>
                                        ) : null}
                                    </Flex>
                                </Flex>
                            </Card>
                        ))}
                    </Flex>
                )}
            </div>
        </Spin>
    );
};

export default MachineTiles;
