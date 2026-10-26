import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { BookingAnalyticsService } from '../analytics/booking-analytics.service';
import { BookingDetailsService } from '../analytics/booking-details.service';
import { RevenueAnalyticsService } from '../analytics/revenue-analytics.service';
import { WorkerPerformanceService } from '../analytics/worker-performance.service';
import { FoodAnalyticsService } from '../analytics/food-analytics.service';
import { ServiceRequestAnalyticsService } from '../analytics/service-request-analytics.service';
import { OccupancyAnalyticsService } from '../analytics/occupancy-analytics.service';
import { LowBookingAlertsService } from '../analytics/low-booking-alerts.service';
import { ReportQuery, ReportType } from './report-query';
import { flattenReport, renderCsv, renderPdf } from './report-renderer';
import { bookingReportPdf, bookingTrendCsv, type BookingReport } from './booking-report';
@Injectable()
export class ReportsService {
  private active = 0;
  constructor(
    private readonly bookings: BookingAnalyticsService,
    private readonly revenue: RevenueAnalyticsService,
    private readonly workers: WorkerPerformanceService,
    private readonly food: FoodAnalyticsService,
    private readonly requests: ServiceRequestAnalyticsService,
    private readonly occupancy: OccupancyAnalyticsService,
    private readonly alerts: LowBookingAlertsService,
    private readonly bookingDetails: BookingDetailsService
  ) {}
  async download(type: ReportType, query: ReportQuery) {
    if (this.active >= 2) throw new ServiceUnavailableException('Exports are busy. Retry shortly.');
    this.active++;
    try {
      let data: Record<string, unknown>;
      let bookingReport: BookingReport | undefined;
      switch (type) {
        case 'bookings': {
          const summary = query.date
            ? await this.bookings.summary(query.period, undefined, query.date)
            : await this.bookings.summary(query.period);
          const details = await this.bookingDetails.details(
            summary.start,
            summary.end,
            1,
            query.format === 'pdf' ? 500 : 1
          );
          if (query.format === 'pdf' && details.bookingList.total > 500)
            throw new UnprocessableEntityException('Select a shorter period: at most 500 booking records per report.');
          bookingReport = { ...summary, ...details };
          data = bookingReport;
          break;
        }
        case 'revenue':
          data = query.date
            ? await this.revenue.summary(query.period, undefined, query.date)
            : await this.revenue.summary(query.period);
          break;
        case 'staff':
        case 'worker-performance': {
          const result = await this.workers.summary({ period: query.period, workerId: query.workerId }, 201);
          if (result.workers.length > 200)
            throw new UnprocessableEntityException('Limit the report to a worker: at most 200 workers per export.');
          data = result;
          break;
        }
        case 'food-orders':
          data = query.date ? await this.food.summary(query.period, query.date) : await this.food.summary(query.period);
          break;
        case 'service-requests':
          data = await this.requests.summary(query.period);
          break;
        case 'occupancy':
          data = await this.occupancy.calendar({
            from: query.from!,
            to: query.to!
          });
          break;
        case 'low-booking-alerts':
          data = await this.alerts.alerts();
          break;
      }
      const rows = flattenReport({
        ...data,
        requestedFilters:
          type === 'occupancy'
            ? { from: query.from, to: query.to }
            : type === 'low-booking-alerts'
              ? {}
              : {
                  period: query.period,
                  ...(query.date ? { date: query.date } : {}),
                  ...(query.workerId ? { workerId: query.workerId } : {})
                }
      });
      const title = type.replaceAll('-', ' ') + ' report';
      const period = `${String(data.start ?? data.from)} to ${String(data.end ?? data.to)} (${data.rangeEndInclusive ? 'inclusive dates' : 'exclusive end'})`;
      const buffer = bookingReport
        ? query.format === 'csv'
          ? bookingTrendCsv(bookingReport)
          : await bookingReportPdf(bookingReport)
        : query.format === 'csv'
          ? renderCsv(rows)
          : await renderPdf(title, period, rows);
      const date =
        typeof data.from === 'string'
          ? data.from
          : new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Colombo',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }).format(new Date(String(data.start)));
      return {
        buffer,
        filename: `${type}-${date}.${query.format}`,
        contentType: query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf'
      };
    } finally {
      this.active--;
    }
  }
}
