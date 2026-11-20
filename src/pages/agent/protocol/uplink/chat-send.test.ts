import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChatSendMetadata } from './chat-send-metadata.ts';

describe('buildChatSend locale metadata', () => {
  it('always includes the interface locale', () => {
    assert.deepEqual(buildChatSendMetadata('en-US'), { locale: 'en-US' });
  });

  it('keeps attachments and locale in the same metadata object', () => {
    assert.deepEqual(buildChatSendMetadata('vi-VN', [{ name: 'a.txt', size: 12 }]), {
      locale: 'vi-VN',
      attachments: [{ name: 'a.txt', size: 12 }],
    });
  });
});
