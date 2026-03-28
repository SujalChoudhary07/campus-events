const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'mini_project',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

function parseJsonField(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        fullname: user.fullname,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        passwordHash: user.password_hash,
        passwordSalt: user.password_salt
    };
}

function normalizeProfile(profile) {
    if (!profile) return {};
    return {
        ...parseJsonField(profile.data, {}),
        username: profile.username,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
    };
}

function normalizeEvent(event) {
    if (!event) return null;
    return {
        id: event.id,
        title: event.title,
        desc: event.description,
        date: event.event_date,
        organizer: event.organizer,
        createdAt: event.created_at,
        updatedAt: event.updated_at
    };
}

function normalizeRegistration(registration) {
    if (!registration) return null;
    return {
        id: registration.id,
        username: registration.username,
        eventId: registration.event_id,
        code: registration.code,
        status: registration.status,
        registeredAt: registration.registered_at
    };
}

function normalizeTicket(ticket) {
    if (!ticket) return null;
    return {
        id: ticket.id,
        user: ticket.user,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at
    };
}

function normalizeNote(note) {
    if (!note) return null;
    return {
        id: note.id,
        ...parseJsonField(note.data, {}),
        createdAt: note.created_at
    };
}

function normalizeChatMessage(message) {
    if (!message) return null;
    return {
        id: message.id,
        eventId: message.event_id,
        username: message.username,
        fullname: message.fullname,
        role: message.role,
        message: message.message,
        createdAt: message.created_at
    };
}

async function createDatabaseIfNeeded() {
    const bootstrap = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password
    });

    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
    await bootstrap.end();
}

async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

async function ensureSchema() {
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(255) NULL,
            username VARCHAR(100) NOT NULL UNIQUE,
            email VARCHAR(255) NULL,
            phone VARCHAR(50) NULL,
            role VARCHAR(50) NULL,
            password_hash TEXT NULL,
            password_salt VARCHAR(255) NULL,
            created_at VARCHAR(50) NOT NULL,
            updated_at VARCHAR(50) NULL
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS profiles (
            username VARCHAR(100) NOT NULL PRIMARY KEY,
            data JSON NOT NULL,
            created_at VARCHAR(50) NOT NULL,
            updated_at VARCHAR(50) NULL,
            CONSTRAINT fk_profiles_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS events (
            id BIGINT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT NULL,
            event_date VARCHAR(100) NULL,
            organizer VARCHAR(100) NULL,
            created_at VARCHAR(50) NOT NULL,
            updated_at VARCHAR(50) NULL,
            INDEX idx_events_organizer (organizer)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS registrations (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            event_id BIGINT NOT NULL,
            code VARCHAR(50) NOT NULL,
            status VARCHAR(50) NOT NULL,
            registered_at VARCHAR(50) NOT NULL,
            UNIQUE KEY uniq_registration (username, event_id),
            CONSTRAINT fk_registrations_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
            CONSTRAINT fk_registrations_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS tickets (
            id BIGINT PRIMARY KEY,
            user VARCHAR(100) NOT NULL,
            subject VARCHAR(255) NULL,
            message TEXT NULL,
            status VARCHAR(50) NOT NULL,
            created_at VARCHAR(50) NOT NULL,
            updated_at VARCHAR(50) NULL,
            CONSTRAINT fk_tickets_user FOREIGN KEY (user) REFERENCES users(username) ON DELETE CASCADE
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS notes (
            id BIGINT PRIMARY KEY,
            data JSON NOT NULL,
            created_at VARCHAR(50) NOT NULL
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS sessions (
            token VARCHAR(128) PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            role VARCHAR(50) NULL,
            created_at VARCHAR(50) NOT NULL,
            CONSTRAINT fk_sessions_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS event_chats (
            id BIGINT PRIMARY KEY,
            event_id BIGINT NOT NULL,
            username VARCHAR(100) NOT NULL,
            fullname VARCHAR(255) NULL,
            role VARCHAR(50) NULL,
            message TEXT NOT NULL,
            created_at VARCHAR(50) NOT NULL,
            CONSTRAINT fk_event_chats_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
            CONSTRAINT fk_event_chats_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        )
    `);
}

async function tableHasRows(tableName) {
    const rows = await query(`SELECT COUNT(*) AS count FROM ${tableName}`);
    return Number(rows[0].count) > 0;
}

async function migrateJsonData() {
    const shouldMigrate = String(process.env.MIGRATE_JSON_ON_BOOT || '').toLowerCase() === 'true';
    const dbPath = path.join(process.cwd(), 'db.json');
    if (!shouldMigrate || !fs.existsSync(dbPath)) return;
    if (await tableHasRows('users')) return;

    const raw = fs.readFileSync(dbPath, 'utf8');
    const json = JSON.parse(raw || '{}');
    const users = Array.isArray(json.users) ? json.users : [];
    const profiles = Array.isArray(json.profiles) ? json.profiles : [];
    const events = Array.isArray(json.events) ? json.events : [];
    const registrations = Array.isArray(json.registrations) ? json.registrations : [];
    const tickets = Array.isArray(json.tickets) ? json.tickets : [];
    const notes = Array.isArray(json.notes) ? json.notes : [];
    const sessions = Array.isArray(json.sessions) ? json.sessions : [];
    const eventChats = Array.isArray(json.eventChats) ? json.eventChats : [];

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const user of users) {
            await connection.execute(
                `INSERT INTO users (fullname, username, email, phone, role, password_hash, password_salt, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.fullname || null,
                    user.username,
                    user.email || null,
                    user.phone || null,
                    user.role || null,
                    user.passwordHash || null,
                    user.passwordSalt || null,
                    user.createdAt || new Date().toISOString(),
                    user.updatedAt || null
                ]
            );
        }

        for (const profile of profiles) {
            const { username, createdAt, updatedAt, ...profileData } = profile;
            await connection.execute(
                'INSERT INTO profiles (username, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
                [username, JSON.stringify(profileData), createdAt || new Date().toISOString(), updatedAt || null]
            );
        }

        for (const event of events) {
            await connection.execute(
                `INSERT INTO events (id, title, description, event_date, organizer, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [Number(event.id), event.title, event.desc || null, event.date || null, event.organizer || null, event.createdAt || new Date().toISOString(), event.updatedAt || null]
            );
        }

        for (const registration of registrations) {
            await connection.execute(
                `INSERT INTO registrations (username, event_id, code, status, registered_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [registration.username, Number(registration.eventId), registration.code, registration.status || 'registered', registration.registeredAt || new Date().toISOString()]
            );
        }

        for (const ticket of tickets) {
            await connection.execute(
                `INSERT INTO tickets (id, user, subject, message, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [Number(ticket.id), ticket.user, ticket.subject || null, ticket.message || null, ticket.status || 'open', ticket.createdAt || new Date().toISOString(), ticket.updatedAt || null]
            );
        }

        for (const note of notes) {
            const { id, createdAt, ...noteData } = note;
            await connection.execute(
                'INSERT INTO notes (id, data, created_at) VALUES (?, ?, ?)',
                [Number(id), JSON.stringify(noteData), createdAt || new Date().toISOString()]
            );
        }

        for (const session of sessions) {
            await connection.execute(
                'INSERT INTO sessions (token, username, role, created_at) VALUES (?, ?, ?, ?)',
                [session.token, session.username, session.role || null, session.createdAt || new Date().toISOString()]
            );
        }

        for (const chat of eventChats) {
            await connection.execute(
                `INSERT INTO event_chats (id, event_id, username, fullname, role, message, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [Number(chat.id), Number(chat.eventId), chat.username, chat.fullname || null, chat.role || null, chat.message, chat.createdAt || new Date().toISOString()]
            );
        }

        await connection.commit();
        console.log('Migrated existing db.json data into MySQL.');
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function initDatabase() {
    await createDatabaseIfNeeded();
    pool = mysql.createPool(dbConfig);
    await ensureSchema();
    await migrateJsonData();
}

module.exports = {
    dbConfig,
    initDatabase,
    normalizeChatMessage,
    normalizeEvent,
    normalizeNote,
    normalizeProfile,
    normalizeRegistration,
    normalizeTicket,
    normalizeUser,
    parseJsonField,
    query
};
