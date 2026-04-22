import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
}

const migrationClient = postgres(connectionString, { max: 1 });

await migrate(drizzle(migrationClient), {
    migrationsFolder: './src/db/migrations',
});

await migrationClient.end();
