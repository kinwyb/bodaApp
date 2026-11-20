import React, { useMemo } from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { LANGUAGE_OPTIONS, languageLabel } from './config';
import { useI18n, useLocale } from './context';
import { isAppLocale } from './types';

const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale } = useLocale();
  const { t } = useI18n();

  const items = useMemo<MenuProps['items']>(
    () =>
      LANGUAGE_OPTIONS.map((item) => ({
        key: item.value,
        label: item.label,
      })),
    [],
  );

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (!isAppLocale(key) || key === locale) return;
    setLocale(key);
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items,
        selectable: true,
        selectedKeys: [locale],
        onClick,
      }}
    >
      <Button
        type="text"
        icon={<GlobalOutlined />}
        aria-label={t('语言')}
        title={t('语言')}
      >
        {languageLabel(locale)}
      </Button>
    </Dropdown>
  );
};

export default LanguageSwitcher;
