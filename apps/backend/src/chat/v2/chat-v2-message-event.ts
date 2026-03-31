export type ChatV2MessageReceivedEvent = {
  messageId: string;
  roomId: string;
  message: string;
  socketId: string;
  receivedAt: string;
  senderId?: number;
};
