import { NoopEventPublisherAdapter } from '@/chat/adapter/noop-event-publisher.adapter';

describe('NoopEventPublisherAdapter', () => {
  it('publish 호출이 예외 없이 완료되어야 한다', async () => {
    const adapter = new NoopEventPublisherAdapter();
    await expect(adapter.publish('test-event', { ok: true })).resolves.toBeUndefined();
  });
});
