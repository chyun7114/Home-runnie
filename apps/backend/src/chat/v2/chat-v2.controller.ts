import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CHAT_ROUTES } from '@/common/versioning/api-version.constants';

@ApiTags('채팅(v2)')
@Controller(CHAT_ROUTES.V2_HTTP_BASE_PATH)
@UseGuards(JwtAuthGuard)
export class ChatV2Controller {
  @Get('health')
  getHealth() {
    return {
      version: 'v2',
      status: 'reserved',
      message: 'v2 스켈레톤 경로입니다.',
    };
  }
}
