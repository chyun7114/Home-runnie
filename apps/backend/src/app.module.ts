import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from '@/common/interceptors';
import { HttpExceptionFilter } from '@/common/filters';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@/common/db/db.module';
import { MemberModule } from '@/member/member.module';
import { AuthModule } from '@/auth/auth.module';
import { ReportModule } from '@/report/report.module';
import { PostModule } from '@/post/post.module';
import { ParticipationModule } from '@/participation/participation.module';
import { ScrapModule } from '@/scrap/scrap.module';
import { AdminModule } from '@/admin/admin.module';
import { WarnModule } from '@/warn/warn.module';
import { ChatModule } from '@/chat/chat.module';
import { CommentModule } from '@/comment/comment.module';
import { HealthModule } from '@/health/health.module';
import databaseConfig from '@/common/config/database.config';
import * as path from 'path';
import { MetricsModule } from '@/metrics';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [path.resolve(process.cwd(), 'secret/.env')],
      isGlobal: true,
      load: [databaseConfig],
    }),
    DbModule,
    WarnModule,
    MemberModule,
    AuthModule,
    ReportModule,
    PostModule,
    ParticipationModule,
    ScrapModule,
    AdminModule,
    ChatModule,
    CommentModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
