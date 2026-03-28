const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const {
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
} = require('./database/mysql');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'Mini Project')));

function sanitizeUser(user) {
    if (!user) return user;
    const { passwordHash, passwordSalt, password_hash, password_salt, ...safeUser } = user;
    return safeUser;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { passwordHash, passwordSalt: salt };
}

function passwordMatches(user, password) {
    if (!user || !user.passwordHash || !user.passwordSalt) return false;
    const attemptedHash = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(user.passwordHash, 'hex'), Buffer.from(attemptedHash, 'hex'));
}

async function findUser(username) {
    const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    return normalizeUser(rows[0]);
}

async function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
        token,
        username: user.username,
        role: user.role,
        createdAt: new Date().toISOString()
    };

    await query('DELETE FROM sessions WHERE username = ?', [user.username]);
    await query(
        'INSERT INTO sessions (token, username, role, created_at) VALUES (?, ?, ?, ?)',
        [session.token, session.username, session.role, session.createdAt]
    );

    return token;
}

async function getSessionFromRequest(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    const rows = await query('SELECT token, username, role, created_at FROM sessions WHERE token = ? LIMIT 1', [token]);
    const session = rows[0];
    if (!session) return null;
    return {
        token: session.token,
        username: session.username,
        role: session.role,
        createdAt: session.created_at
    };
}

async function requireAuth(req, res, next) {
    try {
        const session = await getSessionFromRequest(req);
        if (!session) return res.status(401).send('authentication required');

        const user = await findUser(session.username);
        if (!user) {
            await query('DELETE FROM sessions WHERE token = ?', [session.token]);
            return res.status(401).send('session is invalid');
        }

        req.session = session;
        req.user = sanitizeUser(user);
        next();
    } catch (error) {
        next(error);
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).send('authentication required');
        if (!roles.includes(req.user.role)) return res.status(403).send('access denied');
        next();
    };
}

function canAccessUsername(req, username) {
    return req.user && (req.user.username === username || req.user.role === 'admin');
}

app.post('/api/register', async (req, res, next) => {
    try {
        const { fullname, username, email, phone, role, password } = req.body;
        if (!username) return res.status(400).send('username required');
        if (!password || password.length < 6) return res.status(400).send('password must be at least 6 characters');
        if (await findUser(username)) return res.status(409).send('user exists');

        const { passwordHash, passwordSalt } = hashPassword(password);
        const createdAt = new Date().toISOString();

        await query(
            `INSERT INTO users (fullname, username, email, phone, role, password_hash, password_salt, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [fullname || null, username, email || null, phone || null, role || null, passwordHash, passwordSalt, createdAt]
        );

        const user = await findUser(username);
        const authToken = await createSession(user);
        res.json({ ...sanitizeUser(user), authToken });
    } catch (error) {
        next(error);
    }
});

app.post('/api/login', async (req, res, next) => {
    try {
        const { username, password, role } = req.body;
        if (!username) return res.status(400).send('username required');
        if (!password) return res.status(400).send('password required');

        const user = await findUser(username);
        if (!user) return res.status(401).send('user not found');
        if (role && user.role !== role) return res.status(403).send('role mismatch');
        if (!user.passwordHash || !user.passwordSalt) {
            return res.status(401).send('account has no password yet; please register again or reset it');
        }
        if (!passwordMatches(user, password)) return res.status(401).send('invalid password');

        const authToken = await createSession(user);
        res.json({ ...sanitizeUser(user), authToken });
    } catch (error) {
        next(error);
    }
});

app.get('/api/session', requireAuth, (req, res) => {
    res.json(req.user);
});

app.post('/api/logout', requireAuth, async (req, res, next) => {
    try {
        await query('DELETE FROM sessions WHERE token = ?', [req.session.token]);
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
});

app.get('/api/users', requireAuth, requireRole('admin', 'organizer'), async (req, res, next) => {
    try {
        const users = await query('SELECT * FROM users ORDER BY created_at DESC');
        res.json(users.map(row => sanitizeUser(normalizeUser(row))));
    } catch (error) {
        next(error);
    }
});

app.get('/api/users/:username', requireAuth, async (req, res, next) => {
    try {
        const username = req.params.username;
        if (!canAccessUsername(req, username) && req.user.role !== 'organizer') {
            return res.status(403).send('access denied');
        }

        const user = await findUser(username);
        if (!user) return res.status(404).send('user not found');

        const profileRows = await query('SELECT * FROM profiles WHERE username = ? LIMIT 1', [username]);
        const profile = profileRows[0] ? normalizeProfile(profileRows[0]) : {};
        const events = user.role === 'organizer'
            ? (await query('SELECT * FROM events WHERE organizer = ? ORDER BY created_at DESC', [username])).map(normalizeEvent)
            : [];
        const registrations = user.role === 'participant'
            ? (await query('SELECT * FROM registrations WHERE username = ? ORDER BY registered_at DESC', [username])).map(normalizeRegistration)
            : [];
        const tickets = (await query('SELECT * FROM tickets WHERE user = ? ORDER BY created_at DESC', [username])).map(normalizeTicket);

        res.json({ user: sanitizeUser(user), profile, events, registrations, tickets });
    } catch (error) {
        next(error);
    }
});

app.get('/api/profile/:username', requireAuth, async (req, res, next) => {
    try {
        const username = req.params.username;
        if (!canAccessUsername(req, username)) return res.status(403).send('access denied');
        const rows = await query('SELECT * FROM profiles WHERE username = ? LIMIT 1', [username]);
        res.json(rows[0] ? normalizeProfile(rows[0]) : {});
    } catch (error) {
        next(error);
    }
});

app.put('/api/profile/:username', requireAuth, async (req, res, next) => {
    try {
        const username = req.params.username;
        if (!canAccessUsername(req, username)) return res.status(403).send('access denied');

        const existing = await query('SELECT username FROM profiles WHERE username = ? LIMIT 1', [username]);
        const now = new Date().toISOString();

        if (existing[0]) {
            await query('UPDATE profiles SET data = ?, updated_at = ? WHERE username = ?', [JSON.stringify(req.body || {}), now, username]);
        } else {
            await query('INSERT INTO profiles (username, data, created_at, updated_at) VALUES (?, ?, ?, ?)', [username, JSON.stringify(req.body || {}), now, null]);
        }

        const rows = await query('SELECT * FROM profiles WHERE username = ? LIMIT 1', [username]);
        res.json(normalizeProfile(rows[0]));
    } catch (error) {
        next(error);
    }
});

app.get('/api/events', async (req, res, next) => {
    try {
        const events = await query('SELECT * FROM events ORDER BY created_at DESC');
        res.json(events.map(normalizeEvent));
    } catch (error) {
        next(error);
    }
});

app.get('/api/events/:eventId/chat', requireAuth, async (req, res, next) => {
    try {
        const eventId = Number(req.params.eventId);
        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [eventId]);
        if (!eventRows[0]) return res.status(404).send('event not found');

        const messages = await query('SELECT * FROM event_chats WHERE event_id = ? ORDER BY created_at ASC', [eventId]);
        res.json(messages.map(normalizeChatMessage));
    } catch (error) {
        next(error);
    }
});

app.post('/api/events/:eventId/chat', requireAuth, async (req, res, next) => {
    try {
        const eventId = Number(req.params.eventId);
        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [eventId]);
        const event = normalizeEvent(eventRows[0]);
        if (!event) return res.status(404).send('event not found');
        if (event.date && new Date(event.date) < new Date()) {
            return res.status(400).send('chat is closed for past events');
        }

        const message = String(req.body.message || '').trim();
        if (!message) return res.status(400).send('message is required');

        const chatMessage = {
            id: Date.now(),
            eventId,
            username: req.user.username,
            fullname: req.user.fullname || req.user.username,
            role: req.user.role,
            message,
            createdAt: new Date().toISOString()
        };

        await query(
            `INSERT INTO event_chats (id, event_id, username, fullname, role, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [chatMessage.id, chatMessage.eventId, chatMessage.username, chatMessage.fullname, chatMessage.role, chatMessage.message, chatMessage.createdAt]
        );

        res.json(chatMessage);
    } catch (error) {
        next(error);
    }
});

app.post('/api/events', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const { title, desc, date, organizer } = req.body;
        const owner = req.user.role === 'organizer' ? req.user.username : organizer;
        const event = { id: Date.now(), title, desc, date, organizer: owner, createdAt: new Date().toISOString() };

        await query(
            'INSERT INTO events (id, title, description, event_date, organizer, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [event.id, event.title, event.desc || null, event.date || null, event.organizer || null, event.createdAt]
        );

        res.json(event);
    } catch (error) {
        next(error);
    }
});

app.put('/api/events/:id', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [id]);
        const event = normalizeEvent(eventRows[0]);
        if (!event) return res.status(404).send('event not found');
        if (req.user.role === 'organizer' && event.organizer !== req.user.username) {
            return res.status(403).send('access denied');
        }

        const updated = {
            title: req.body.title ?? event.title,
            desc: req.body.desc ?? event.desc,
            date: req.body.date ?? event.date,
            organizer: req.body.organizer ?? event.organizer,
            updatedAt: new Date().toISOString()
        };

        await query(
            'UPDATE events SET title = ?, description = ?, event_date = ?, organizer = ?, updated_at = ? WHERE id = ?',
            [updated.title, updated.desc || null, updated.date || null, updated.organizer || null, updated.updatedAt, id]
        );

        const rows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [id]);
        res.json(normalizeEvent(rows[0]));
    } catch (error) {
        next(error);
    }
});

app.delete('/api/events/:id', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [id]);
        const event = normalizeEvent(eventRows[0]);
        if (!event) return res.status(404).send('event not found');
        if (req.user.role === 'organizer' && event.organizer !== req.user.username) {
            return res.status(403).send('access denied');
        }

        await query('DELETE FROM events WHERE id = ?', [id]);
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
});

app.get('/api/events/organizer/:username', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const username = req.params.username;
        if (req.user.role === 'organizer' && req.user.username !== username) {
            return res.status(403).send('access denied');
        }
        const events = await query('SELECT * FROM events WHERE organizer = ? ORDER BY created_at DESC', [username]);
        res.json(events.map(normalizeEvent));
    } catch (error) {
        next(error);
    }
});

app.get('/api/registrations', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const registrations = await query('SELECT * FROM registrations ORDER BY registered_at DESC');
        res.json(registrations.map(normalizeRegistration));
    } catch (error) {
        next(error);
    }
});

app.get('/api/registrations/:username', requireAuth, async (req, res, next) => {
    try {
        const username = req.params.username;
        if (!canAccessUsername(req, username)) return res.status(403).send('access denied');
        const registrations = await query('SELECT * FROM registrations WHERE username = ? ORDER BY registered_at DESC', [username]);
        res.json(registrations.map(normalizeRegistration));
    } catch (error) {
        next(error);
    }
});

app.post('/api/registrations', requireAuth, async (req, res, next) => {
    try {
        const { username, eventId } = req.body;
        const numericEventId = Number(eventId);
        if (req.user.username !== username && req.user.role !== 'admin') {
            return res.status(403).send('access denied');
        }
        if (!username || !numericEventId) {
            return res.status(400).send('username and eventId are required');
        }
        if (!(await findUser(username))) return res.status(404).send('user not found');

        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [numericEventId]);
        const event = normalizeEvent(eventRows[0]);
        if (!event) return res.status(404).send('event not found');
        const existing = await query('SELECT id FROM registrations WHERE username = ? AND event_id = ? LIMIT 1', [username, numericEventId]);
        if (existing[0]) return res.status(409).send('already registered');
        if (event.date && new Date(event.date) < new Date()) {
            return res.status(400).send('registration is closed for past events');
        }

        const registration = {
            username,
            eventId: numericEventId,
            code: Math.random().toString(36).slice(2, 10).toUpperCase(),
            status: 'registered',
            registeredAt: new Date().toISOString()
        };

        await query(
            'INSERT INTO registrations (username, event_id, code, status, registered_at) VALUES (?, ?, ?, ?, ?)',
            [registration.username, registration.eventId, registration.code, registration.status, registration.registeredAt]
        );

        res.json(registration);
    } catch (error) {
        next(error);
    }
});

app.get('/api/events/:eventId/participants', requireAuth, requireRole('organizer', 'admin'), async (req, res, next) => {
    try {
        const eventId = Number(req.params.eventId);
        const eventRows = await query('SELECT * FROM events WHERE id = ? LIMIT 1', [eventId]);
        const event = normalizeEvent(eventRows[0]);
        if (!event) return res.status(404).send('event not found');
        if (req.user.role === 'organizer' && event.organizer !== req.user.username) {
            return res.status(403).send('access denied');
        }

        const participantRows = await query(
            `SELECT
                r.id AS registration_id,
                r.username AS registration_username,
                r.event_id,
                r.code,
                r.status,
                r.registered_at,
                u.id AS user_id,
                u.fullname,
                u.email,
                u.phone,
                u.role,
                u.created_at AS user_created_at,
                u.updated_at AS user_updated_at,
                p.data AS profile_data,
                p.created_at AS profile_created_at,
                p.updated_at AS profile_updated_at
             FROM registrations r
             JOIN users u ON u.username = r.username
             LEFT JOIN profiles p ON p.username = r.username
             WHERE r.event_id = ?
             ORDER BY r.registered_at DESC`,
            [eventId]
        );

        const participants = participantRows.map(row => ({
            id: row.registration_id,
            username: row.registration_username,
            eventId: row.event_id,
            code: row.code,
            status: row.status,
            registeredAt: row.registered_at,
            user: sanitizeUser({
                id: row.user_id,
                fullname: row.fullname,
                username: row.registration_username,
                email: row.email,
                phone: row.phone,
                role: row.role,
                createdAt: row.user_created_at,
                updatedAt: row.user_updated_at
            }),
            profile: row.profile_data
                ? {
                    ...parseJsonField(row.profile_data, {}),
                    username: row.registration_username,
                    createdAt: row.profile_created_at,
                    updatedAt: row.profile_updated_at
                }
                : {}
        }));

        res.json(participants);
    } catch (error) {
        next(error);
    }
});

app.get('/api/tickets', requireAuth, async (req, res, next) => {
    try {
        const tickets = req.user.role === 'admin'
            ? await query('SELECT * FROM tickets ORDER BY created_at DESC')
            : await query('SELECT * FROM tickets WHERE user = ? ORDER BY created_at DESC', [req.user.username]);
        res.json(tickets.map(normalizeTicket));
    } catch (error) {
        next(error);
    }
});

app.post('/api/tickets', requireAuth, async (req, res, next) => {
    try {
        const { user, subject, message } = req.body;
        if (req.user.username !== user && req.user.role !== 'admin') {
            return res.status(403).send('access denied');
        }

        const ticket = {
            id: Date.now(),
            user,
            subject,
            message,
            status: 'open',
            createdAt: new Date().toISOString()
        };

        await query(
            'INSERT INTO tickets (id, user, subject, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [ticket.id, ticket.user, ticket.subject || null, ticket.message || null, ticket.status, ticket.createdAt]
        );

        res.json(ticket);
    } catch (error) {
        next(error);
    }
});

app.get('/api/tickets/:username', requireAuth, async (req, res, next) => {
    try {
        const username = req.params.username;
        if (!canAccessUsername(req, username)) return res.status(403).send('access denied');
        const tickets = await query('SELECT * FROM tickets WHERE user = ? ORDER BY created_at DESC', [username]);
        res.json(tickets.map(normalizeTicket));
    } catch (error) {
        next(error);
    }
});

app.put('/api/tickets/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const rows = await query('SELECT * FROM tickets WHERE id = ? LIMIT 1', [id]);
        const existing = normalizeTicket(rows[0]);
        if (!existing) return res.status(404).send('ticket not found');

        const updated = {
            subject: req.body.subject ?? existing.subject,
            message: req.body.message ?? existing.message,
            status: req.body.status ?? existing.status,
            updatedAt: new Date().toISOString()
        };

        await query(
            'UPDATE tickets SET subject = ?, message = ?, status = ?, updated_at = ? WHERE id = ?',
            [updated.subject || null, updated.message || null, updated.status || 'open', updated.updatedAt, id]
        );

        const ticketRows = await query('SELECT * FROM tickets WHERE id = ? LIMIT 1', [id]);
        res.json(normalizeTicket(ticketRows[0]));
    } catch (error) {
        next(error);
    }
});

app.get('/api/notes', requireAuth, async (req, res, next) => {
    try {
        const notes = await query('SELECT * FROM notes ORDER BY created_at DESC');
        res.json(notes.map(normalizeNote));
    } catch (error) {
        next(error);
    }
});

app.post('/api/notes', requireAuth, async (req, res, next) => {
    try {
        const note = { id: Date.now(), ...req.body, createdAt: new Date().toISOString() };
        const { id, createdAt, ...noteData } = note;
        await query('INSERT INTO notes (id, data, created_at) VALUES (?, ?, ?)', [id, JSON.stringify(noteData), createdAt]);
        res.json(note);
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/summary', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
        const [users, events, registrations, tickets, profiles] = await Promise.all([
            query('SELECT * FROM users'),
            query('SELECT * FROM events'),
            query('SELECT * FROM registrations'),
            query('SELECT * FROM tickets'),
            query('SELECT * FROM profiles')
        ]);

        const normalizedUsers = users.map(row => sanitizeUser(normalizeUser(row)));
        const normalizedEvents = events.map(normalizeEvent);
        const normalizedRegistrations = registrations.map(normalizeRegistration);
        const normalizedTickets = tickets.map(normalizeTicket);
        const normalizedProfiles = profiles.map(normalizeProfile);

        res.json({
            totalUsers: normalizedUsers.length,
            participants: normalizedUsers.filter(user => user.role === 'participant').length,
            organizers: normalizedUsers.filter(user => user.role === 'organizer').length,
            volunteers: normalizedUsers.filter(user => user.role === 'volunteer').length,
            totalEvents: normalizedEvents.length,
            totalRegistrations: normalizedRegistrations.length,
            openTickets: normalizedTickets.filter(ticket => ticket.status === 'open').length,
            users: normalizedUsers,
            events: normalizedEvents,
            registrations: normalizedRegistrations,
            tickets: normalizedTickets,
            profiles: normalizedProfiles
        });
    } catch (error) {
        next(error);
    }
});

app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'internal server error', detail: error.message });
});

async function startServer() {
    await initDatabase();
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
}

startServer().catch(error => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
});


