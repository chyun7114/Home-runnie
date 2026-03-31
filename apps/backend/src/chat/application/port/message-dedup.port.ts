export const MESSAGE_DEDUP_PORT = Symbol('MESSAGE_DEDUP_PORT');

export interface MessageDedupPort {
  reserve(messageId: string): Promise<boolean>;
}
