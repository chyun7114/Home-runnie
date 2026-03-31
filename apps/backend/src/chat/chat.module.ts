import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from '@/chat/chat.gateway';
import { WsJwtGuard } from '@/chat/ws-jwt.guard';
import { ChatService } from '@/chat/service';
import { ChatRepository } from '@/chat/repository';
import { ChatController } from '@/chat/controller';
import { ChatV2Controller, ChatV2GatewayAdapter } from '@/chat/v2';
import { ChatGatewayRoomEventAdapter } from '@/chat/adapter';
import { DbModule } from '@/common/db/db.module';
import { MemberModule } from '@/member/member.module';
import { ROOM_EVENT_PORT } from '@/chat/application/port';

@Module({
  imports: [
    DbModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
    MemberModule,
  ],
  controllers: [ChatController, ChatV2Controller],
  providers: [
    ChatGateway,
    ChatV2GatewayAdapter,
    ChatGatewayRoomEventAdapter,
    WsJwtGuard,
    ChatService,
    ChatRepository,
    {
      provide: ROOM_EVENT_PORT,
      useExisting: ChatGatewayRoomEventAdapter,
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}
