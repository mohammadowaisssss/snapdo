import * as dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || process.env.BACKEND_PORT || 5000),
  APP_URL: process.env.APP_URL || 'http://localhost:4000',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'mohammadowais616@gmail.com',
};
