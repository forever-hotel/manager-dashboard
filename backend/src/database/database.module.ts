import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: true } : false,
        autoLoadEntities: true,
        synchronize: false,
        logging: config.get<string>('DB_LOGGING') === 'true',
        // Allow transient hosted-database connection failures during startup.
        retryAttempts: 12,
        retryDelay: 3000,
        // Hosted DB connection/TLS setup can take longer than a local connection.
        // Keep the SQL timeout separate so slow application queries stay bounded.
        extra: { connectionTimeoutMillis: 15000, statement_timeout: 5000, keepAlive: true }
      })
    })
  ]
})
export class DatabaseModule {}
