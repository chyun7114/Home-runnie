import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from '@/metrics/metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics() {
    return this.metricsService.metricsText();
  }
}
