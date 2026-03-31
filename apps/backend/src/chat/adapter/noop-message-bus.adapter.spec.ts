import { NoopMessageBusAdapter } from '@/chat/adapter/noop-message-bus.adapter';

describe('NoopMessageBusAdapter', () => {
  it('publish 호출이 예외 없이 완료되어야 한다', async () => {
    const adapter = new NoopMessageBusAdapter();
    await expect(adapter.publish('test-channel', { ok: true })).resolves.toBeUndefined();
  });
});
