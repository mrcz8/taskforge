import { pgTable, char, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable(
    'users',
    {
        id: char('id', { length: 26 }).primaryKey(),
        email: varchar('email', { length: 255 }).notNull(),
        name: varchar('name', { length: 255 }).notNull(),
        passwordHash: text('password_hash').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => ({
        emailUnique: uniqueIndex('users_email_unique').on(table.email),
    }),
);
