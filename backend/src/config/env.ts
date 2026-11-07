import * as dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || process.env.BACKEND_PORT || 5000),
  DATA_DIR: process.env.DATA_DIR || '',
  APP_URL: process.env.APP_URL || 'http://localhost:4000',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  PGHOST: process.env.SQL_HOST || process.env.PGHOST || 'db',
  PGPORT: Number(process.env.PGPORT || 5432),
  PGUSER: process.env.SQL_USER || process.env.PGUSER || 'snapsec',
  PGPASSWORD: process.env.SQL_PASSWORD || process.env.PGPASSWORD || 'snapsec_prod_secret',
  PGDATABASE: process.env.SQL_DB_NAME || process.env.PGDATABASE || 'snapsec_tasktracker',
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || 'minio',
  MINIO_PORT: Number(process.env.MINIO_PORT || 9000),
  MINIO_USE_SSL: process.env.MINIO_USE_SSL === 'true',
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'snapsec_minio',
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || 'snapsec_minio_secret',
  MINIO_BUCKET: process.env.MINIO_BUCKET || 'snapsec-attachments',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'mohammadowais616@gmail.com',
};
