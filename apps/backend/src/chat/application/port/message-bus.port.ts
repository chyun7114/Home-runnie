export const MESSAGE_BUS_PORT = Symbol('MESSAGE_BUS_PORT');

export interface MessageBusPort {
  publish(channel: string, payload: unknown): Promise<void>;
}
