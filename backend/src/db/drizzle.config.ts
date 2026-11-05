import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST || process.env.PGHOST || 'localhost';
const sqlDbName = process.env.SQL_DB_NAME || process.env.PGDATABASE || 'snapsec_tasktracker';
const user = process.env.SQL_ADMIN_USER || process.env.PGUSER || 'snapsec';
const password = process.env.SQL_ADMIN_PASSWORD || process.env.PGPASSWORD || 'snapsec_prod_secret';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql' as const,
  schemaFilter: ['public'],
  dbCredentials: {
    host: sqlHost,
    user,
    password,
    database: sqlDbName,
    ssl: false,
  },
  verbose: true,
};

