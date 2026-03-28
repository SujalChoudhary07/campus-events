const express = require('express');
const cors = require('cors');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// Database setup (lowdb v1)
const file = path.join(__dirname, 'db.json');
const adapter = new FileSync(file);
const db = low(adapter);

db.defaults({
    users: [],
    events: [],
    registrations: [],
    tickets: [],
    profiles: [],
    eventChats: []
}).write();

// Helper
function findUser(username) {
    return db.get('users').find({ username }).value();
}

function generateRegistrationCode() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// ================= AUTH =================

app.post('/api/register', (req, res) => {
    const { fullname, username, password, role } = req.body;
    if (!username || !password) return res.status(400).send('username and password required');

    if (findUser(username)) return res.status(409).send('user exists');

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = { fullname, username, password: hashedPassword, role };
    db.get('users').push(user).write();
    res.json({ fullname, username, role });
});

app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).send('username, password and role required');

    const user = findUser(username);
    if (!user) return res.status(401).send('user not found');

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) return res.status(401).send('invalid password');

    if (user.role !== role) return res.status(403).send('role mismatch');

    res.json({ fullname: user.fullname, username: user.username, role: user.role });
});

// ================= EVENTS =================

app.get('/api/events', (req, res) => {
    res.json(db.get('events').value());
});

app.get('/api/events/:eventId/chat', (req, res) => {
    const eventId = Number(req.params.eventId);
    const event = db.get('events').find({ id: eventId }).value();
    if (!event) return res.status(404).send('event not found');

    const messages = db.get('eventChats')
        .filter({ eventId })
        .sortBy('createdAt')
        .value();

    res.json(messages);
});

app.post('/api/events/:eventId/chat', (req, res) => {
    const eventId = Number(req.params.eventId);
    const event = db.get('events').find({ id: eventId }).value();
    if (!event) return res.status(404).send('event not found');

    if (event.date && new Date(event.date) < new Date()) {
        return res.status(400).send('chat is closed for past events');
    }

    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).send('message is required');

    const chatMessage = {
        id: Date.now(),
        eventId,
        username: req.body.username || 'guest',
        fullname: req.body.fullname || req.body.username || 'Guest User',
        role: req.body.role || 'participant',
        message,
        createdAt: new Date().toISOString()
    };

    db.get('eventChats').push(chatMessage).write();
    res.json(chatMessage);
});

app.post('/api/events', (req, res) => {
    const e = req.body;
    e.id = Date.now();
    e.createdAt = new Date().toISOString();
    db.get('events').push(e).write();
    res.json(e);
});

app.put('/api/events/:id', (req, res) => {
    const id = parseInt(req.params.id);

    const event = db.get('events').find({ id }).value();
    if (!event) return res.status(404).send('event not found');

    db.get('events')
      .find({ id })
      .assign({
          ...req.body
      })
      .write();

    res.json(db.get('events').find({ id }).value());
});

app.delete('/api/events/:id', (req, res) => {
    const id = parseInt(req.params.id);

    db.get('events').remove({ id }).write();
    db.get('registrations').remove({ eventId: id }).write();

    res.sendStatus(204);
});

// ================= REGISTRATIONS =================

app.get('/api/registrations', (req, res) => {
    res.json(db.get('registrations').value());
});

app.put('/api/registrations/manage/:eventId/:username', (req, res) => {
    const eventId = Number(req.params.eventId);
    const username = req.params.username;
    const status = String(req.body.status || '').trim().toLowerCase();

    const registration = db.get('registrations').find({ eventId, username }).value();
    if (!registration) {
        return res.status(404).send('registration not found');
    }

    if (!['registered', 'rejected', 'pending_approval'].includes(status)) {
        return res.status(400).send('invalid registration status');
    }

    const updates = {
        status,
        reviewedAt: new Date().toISOString()
    };

    if (status === 'registered') {
        updates.code = registration.code || generateRegistrationCode();
        updates.registeredAt = registration.registeredAt || new Date().toISOString();
    } else if (status === 'rejected') {
        updates.code = '';
    }

    db.get('registrations')
        .find({ eventId, username })
        .assign(updates)
        .write();

    res.json(db.get('registrations').find({ eventId, username }).value());
});

app.get('/api/registrations/:username', (req, res) => {
    const username = req.params.username;
    const regs = db.get('registrations')
                   .filter({ username })
                   .value();
    res.json(regs);
});

app.post('/api/registrations', (req, res) => {
    const { username, eventId } = req.body;
    const numericEventId = Number(eventId);

    if (!username || !numericEventId) {
        return res.status(400).send('username and eventId are required');
    }

    const event = db.get('events').find({ id: numericEventId }).value();
    if (!event) {
        return res.status(404).send('event not found');
    }

    const existing = db.get('registrations').find({ username, eventId: numericEventId }).value();
    if (existing) {
        return res.status(409).send('already registered');
    }

    if (event.date && new Date(event.date) < new Date()) {
        return res.status(400).send('registration is closed for past events');
    }

    const reg = {
        username,
        eventId: numericEventId,
        code: generateRegistrationCode(),
        time: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
        status: 'registered'
    };

    db.get('registrations').push(reg).write();
    res.json(reg);
});

// ================= TICKETS =================

app.get('/api/tickets', (req, res) => {
    res.json(db.get('tickets').value());
});

app.post('/api/tickets', (req, res) => {
    const { user, message } = req.body;

    const ticket = {
        user,
        message,
        time: new Date().toLocaleTimeString(),
        status: 'open'
    };

    db.get('tickets').push(ticket).write();
    res.json(ticket);
});

// ================= PROFILE =================

app.get('/api/profile/:username', (req, res) => {
    const username = req.params.username;
    const profile = db.get('profiles')
                      .find({ username })
                      .value() || {};
    res.json(profile);
});

app.put('/api/profile/:username', (req, res) => {
    const username = req.params.username;

    let profile = db.get('profiles')
                    .find({ username })
                    .value();

    if (profile) {
        db.get('profiles')
          .find({ username })
          .assign({ ...req.body, updatedAt: new Date().toISOString() })
          .write();
    } else {
        db.get('profiles')
          .push({ ...req.body, username, createdAt: new Date().toISOString() })
          .write();
    }

    res.json(db.get('profiles').find({ username }).value());
});

// ================= USERS (Admin View) =================

app.get('/api/users', (req, res) => {
    res.json(db.get('users').value());
});

// ================= START SERVER =================

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Server listening on', port));




mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log("MongoDB Connected ✅"))
.catch(err => console.log("Error ❌", err));