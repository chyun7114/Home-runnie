export const ROOM_EVENT_PORT = Symbol('ROOM_EVENT_PORT');

export interface RoomEventPort {
  emitToRoom(roomId: string, event: string, data: unknown): void;
  emitJoinRequestReceived(roomId: string, data: unknown): void;
  emitMemberJoined(roomId: string, data: unknown): void;
  emitJoinRequestRejected(roomId: string, data: unknown): void;
  emitMemberKicked(roomId: string, data: unknown): void;
  emitRoomDeleted(roomId: string): void;
}
