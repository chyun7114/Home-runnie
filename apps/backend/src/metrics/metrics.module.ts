import { Global, Module } from '@nestjs/common';
import { MetricsService } from '@/metrics/metrics.service';
import { MetricsController } from '@/metrics/metrics.controller';

@Global()
@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
