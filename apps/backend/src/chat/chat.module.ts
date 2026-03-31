import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from '@/chat/chat.gateway';
import { WsJwtGuard } from '@/chat/ws-jwt.guard';
import { ChatService } from '@/chat/service';
import { ChatRepository } from '@/chat/repository';
import { ChatController } from '@/chat/controller';
import { ChatV2Controller, ChatV2GatewayAdapter } from '@/chat/v2';
import {
  ChatGatewayRoomEventAdapter,
  NoopEventPublisherAdapter,
  NoopMessageBusAdapter,
  RabbitMqEventPublisherAdapter,
  RedisMessageBusAdapter,
} from '@/chat/adapter';
import { DbModule } from '@/common/db/db.module';
import { MemberModule } from '@/member/member.module';
import { EVENT_PUBLISHER_PORT, MESSAGE_BUS_PORT, ROOM_EVENT_PORT } from '@/chat/application/port';

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
    {
      provide: MESSAGE_BUS_PORT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const useExternalBrokers = configService.get<string>('CHAT_USE_EXTERNAL_BROKERS', 'false');
        if (useExternalBrokers === 'true') {
          return new RedisMessageBusAdapter(configService);
        }
        return new NoopMessageBusAdapter();
      },
    },
    {
      provide: EVENT_PUBLISHER_PORT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const useExternalBrokers = configService.get<string>('CHAT_USE_EXTERNAL_BROKERS', 'false');
        if (useExternalBrokers === 'true') {
          return new RabbitMqEventPublisherAdapter(configService);
        }
        return new NoopEventPublisherAdapter();
      },
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}
