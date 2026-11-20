import type { AppLocale } from '@/i18n';

export type ChatSendAttachment = { name: string; size: number };

export function buildChatSendMetadata(
  locale: AppLocale,
  attachments?: ChatSendAttachment[],
): Record<string, unknown> {
  return {
    locale,
    ...(attachments?.length ? { attachments } : {}),
  };
}
