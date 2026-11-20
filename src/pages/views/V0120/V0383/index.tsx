import React from 'react';
import {misReportApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {EfficiencyReportPage} from '../efficiencyReport';
import {createSpinnerEfficiencyBridge} from './bridged';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0383");


const SpinnerEfficiencyPage: React.FC<ViewPageProps> = (props) => (
    <EfficiencyReportPage
        {...props}
        title={t("MIS > 挡车效率")}
        exportName={t("挡车效率")}
        loadReport={misReportApi.spinnerRate}
        createBridge={createSpinnerEfficiencyBridge}
    />
);

export default SpinnerEfficiencyPage;
