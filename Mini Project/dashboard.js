/*
  Modified dashboard script to interact with backend API instead of localStorage.
  Server must expose endpoints under /api.  See server.js for implementation.
*/

let events = [];
let registrations = {};
let notifications = [];
let tickets = [];
let currentFilter = 'upcoming';
let currentProfile = {};
let chatMessages = [];
let selectedChatEventId = null;
let homeTab = 'upcoming';
const LOCAL_EVENT_CHAT_PREFIX = 'localEventChat:';
const SAMPLE_UPCOMING_EVENTS = [
    {
        id: -101,
        title: "AI Innovation Summit",
        desc: "Student teams present AI tools, demos, and smart campus ideas.",
        date: "2026-04-18",
        localOnly: true
    },
    {
        id: -102,
        title: "Startup Pitch Arena",
        desc: "Pitch your startup idea to mentors and compete for the top prize.",
        date: "2026-05-08",
        localOnly: true
    },
    {
        id: -103,
        title: "Design Sprint Challenge",
        desc: "A fast-paced UI and UX competition for creative student builders.",
        date: "2026-06-14",
        localOnly: true
    }
];

const FALLBACK_EVENTS = [
    {
        id: 5001,
        title: "Campus Sustainability Forum",
        desc: "Workshops and panels on greener campus living.",
        date: "2026-04-12"
    },
    {
        id: 5002,
        title: "Student Startup Mixer",
        desc: "Speed networking for founders and investors.",
        date: "2026-05-05"
    },
    {
        id: 5003,
        title: "Global Languages Festival",
        desc: "Cultural programs celebrating multilingual expression.",
        date: "2026-06-01"
    }
];
const EVENT_INTEREST_KEYWORDS = {
    tech: ['tech', 'coding', 'code', 'hackathon', 'ai', 'robotics', 'startup', 'innovation', 'developer', 'design sprint'],
    sports: ['sport', 'sports', 'football', 'cricket', 'basketball', 'badminton', 'athletic', 'tournament', 'marathon'],
    cultural: ['cultural', 'dance', 'music', 'art', 'drama', 'fashion', 'festival', 'performance', 'night']
};

function getCurrentUser() {
    return JSON.parse(localStorage.getItem('user') || '{}');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getLocalRegistrations(username) {
    if (!username) return [];
    try {
        return JSON.parse(localStorage.getItem(`localRegs:${username}`) || '[]');
    } catch (error) {
        return [];
    }
}

function saveLocalRegistrations(username, regs) {
    if (!username) return;
    localStorage.setItem(`localRegs:${username}`, JSON.stringify(regs));
}

function getLocalEventChat(eventId) {
    if (!eventId) return [];
    try {
        return JSON.parse(localStorage.getItem(`${LOCAL_EVENT_CHAT_PREFIX}${eventId}`) || '[]');
    } catch (error) {
        return [];
    }
}

function saveLocalEventChat(eventId, messages) {
    if (!eventId) return;
    localStorage.setItem(`${LOCAL_EVENT_CHAT_PREFIX}${eventId}`, JSON.stringify(messages));
}

function isUpcomingEvent(event) {
    if (!event || !event.date) return false;
    return new Date(event.date) >= new Date();
}

function isRegisteredForEvent(username, eventId) {
    return (registrations[username] || []).some(r => r.eventId === eventId);
}

function getRegistrationForEvent(username, eventId) {
    return (registrations[username] || []).find(r => r.eventId === eventId);
}

function getEventFeeLabel() {
    return 'Free for all participants';
}

function getOpenChatButton(event) {
    if (!event || !event.date || !isUpcomingEvent(event)) {
        return '<button class="card-btn ripple secondary-chat-btn" disabled>Chat Closed</button>';
    }
    return `<button class="card-btn ripple secondary-chat-btn" onclick="openEventChat(${event.id})">Open Chat</button>`;
}

function getEventActionButton(event, username) {
    if (!event || !event.date) {
        return '<button class="card-btn ripple join-btn" disabled>Date Pending</button>';
    }

    const isUpcoming = isUpcomingEvent(event);
    const registration = getRegistrationForEvent(username, event.id);
    const joined = Boolean(registration);

    if (!isUpcoming) {
        return '<button class="card-btn ripple join-btn" disabled>Event Closed</button>';
    }

    if (joined) {
        return '<button class="card-btn ripple join-btn" disabled>Already Joined</button>';
    }

    return `<button class="card-btn ripple join-btn" onclick="registerEventById(${event.id})">Join Event</button>`;
}

// --- backend helpers -------------------------------------------------------
async function api(path, opts={}) {
    const res = await apiFetch('/api' + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

// events
async function loadEvents() {
    try {
        events = await api('/events');
    } catch (e) {
        console.error('loadEvents error', e);
        events = [];
    }
    const merged = [...events];
    SAMPLE_UPCOMING_EVENTS.forEach(sampleEvent => {
        const exists = merged.some(event =>
            event.id === sampleEvent.id ||
            (event.title === sampleEvent.title && event.date === sampleEvent.date)
        );
        if (!exists) merged.push({ ...sampleEvent });
    });
    events = merged;
    if (events.length === 0) {
        events = FALLBACK_EVENTS.map(event => ({ ...event }));
    }
}
async function createEvent(e) {
    const newE = await api('/events', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(e) });
    events.push(newE);
    return newE;
}
async function updateEventObj(id, e) {
    await api(`/events/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(e) });
    await loadEvents();
}
async function deleteEventObj(id) {
    await api(`/events/${id}`, { method: 'DELETE' });
    await loadEvents();
}

// registrations
async function loadRegistrations(username) {
    try {
        registrations[username] = await api(`/registrations/${username}`);
    } catch (e) {
        console.error('loadRegs error', e);
        registrations[username] = [];
    }
    const localRegs = getLocalRegistrations(username);
    const mergedRegs = [...registrations[username]];
    localRegs.forEach(localReg => {
        if (!mergedRegs.some(reg => reg.eventId === localReg.eventId)) {
            mergedRegs.push(localReg);
        }
    });
    registrations[username] = mergedRegs;
}
async function addRegistration(username, eventId) {
    const event = events.find(item => item.id === eventId);
    if (event && event.localOnly) {
        const reg = {
            username,
            eventId,
            code: generateCode(),
            status: 'registered',
            registeredAt: new Date().toISOString(),
            localOnly: true
        };
        const existingLocalRegs = getLocalRegistrations(username);
        existingLocalRegs.push(reg);
        saveLocalRegistrations(username, existingLocalRegs);
        registrations[username].push(reg);
        return reg;
    }
    const reg = await api('/registrations', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, eventId })
    });
    registrations[username].push(reg);
    return reg;
}

async function loadEventChat(eventId) {
    if (!eventId) {
        chatMessages = [];
        return chatMessages;
    }
    const event = events.find(item => item.id === eventId);
    if (event && event.localOnly) {
        chatMessages = getLocalEventChat(eventId);
        return chatMessages;
    }
    try {
        chatMessages = await api(`/events/${eventId}/chat`);
    } catch (error) {
        console.error('load chat error', error);
        chatMessages = [];
    }
    return chatMessages;
}

async function sendEventChatMessage(eventId, message) {
    const event = events.find(item => item.id === eventId);
    if (event && event.localOnly) {
        const user = getCurrentUser();
        const created = {
            id: Date.now(),
            eventId,
            username: user.username || 'guest',
            fullname: user.fullname || user.username || 'Guest User',
            role: user.role || 'participant',
            message,
            createdAt: new Date().toISOString(),
            localOnly: true
        };
        const localMessages = getLocalEventChat(eventId);
        localMessages.push(created);
        saveLocalEventChat(eventId, localMessages);
        chatMessages = localMessages;
        return created;
    }
    const payload = { message };
    const created = await api(`/events/${eventId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    chatMessages.push(created);
    return created;
}

// tickets
async function loadTickets() {
    try { tickets = await api('/tickets'); } catch(e){console.error(e); tickets=[];}    
}
async function createTicket(msg, user) {
    const t = await api('/tickets', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user, message: msg }) });
    tickets.unshift(t);
    return t;
}

// notifications kept client-side
function addNotification(text) {
    const obj = { text, time: new Date().toLocaleTimeString() };
    notifications.unshift(obj);
    renderNotifications();
}
function renderNotifications() {
    const container = document.getElementById('notifList');
    if (!container) return;
    if (notifications.length === 0) {
        container.innerHTML = '<p>No notifications yet.</p>';
        return;
    }
    container.innerHTML = '';
    notifications.forEach(n => {
        const p = document.createElement('p');
        p.textContent = `[${n.time}] ${n.text}`;
        container.appendChild(p);
    });
}

function renderTickets() {
    const container = document.getElementById('ticketList');
    if (!container) return;
    if (!tickets.length) {
        container.innerHTML = '<p>No support tickets yet.</p>';
        return;
    }
    container.innerHTML = tickets.map(t => {
        const when = t.createdAt ? new Date(t.createdAt).toLocaleString() : (t.time || '');
        return `<p><strong>${t.user || 'User'}:</strong> ${t.message || ''}<br><span class="subtle-text">${when}</span></p>`;
    }).join('');
}

// profile
async function fetchProfile(username) {
    try { return await api(`/profile/${username}`); } catch(e){return {};}
}
async function saveProfile(profile) {
    return await api(`/profile/${profile.username}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(profile) });
}
async function loadCurrentProfile(username) {
    currentProfile = username ? await fetchProfile(username) : {};
    return currentProfile;
}

function getEventCategories(event) {
    const haystack = `${event?.title || ''} ${event?.desc || ''}`.toLowerCase();
    return Object.entries(EVENT_INTEREST_KEYWORDS)
        .filter(([, keywords]) => keywords.some(keyword => haystack.includes(keyword)))
        .map(([category]) => category);
}

function getProfileInterestCategories() {
    const raw = currentProfile?.interests;
    const haystack = (Array.isArray(raw) ? raw.join(' ') : String(raw || '')).toLowerCase();
    return Object.entries(EVENT_INTEREST_KEYWORDS)
        .filter(([, keywords]) => keywords.some(keyword => haystack.includes(keyword)))
        .map(([category]) => category);
}

// event UI
function renderEvents(list) {
    const container = document.getElementById('eventContainer');
    const listView = document.getElementById('eventsListView');
    container.innerHTML = '';
    if (listView) listView.innerHTML = '';
    let arr = list || events;
    const now = new Date();
    const user = getCurrentUser();
    if (currentFilter === 'upcoming') {
        arr = arr.filter(e => e.date && new Date(e.date) >= now);
    } else if (currentFilter === 'past') {
        arr = arr.filter(e => e.date && new Date(e.date) < now);
    }
    if (!arr.length) {
        container.innerHTML = '<p>No events found for this view.</p>';
        if (listView) listView.innerHTML = '<p>No events found for this view.</p>';
        return;
    }
    arr.forEach((e, index) => {
        const card = document.createElement('div');
        card.className = 'event-card reveal active';
        let countdownHtml = '';
        let statusText = '<p><em>Date not announced yet</em></p>';
        let eventTypeBadge = '<span class="event-status-badge">Event</span>';
        let actionHtml = `${getEventActionButton(e, user.username)}${getOpenChatButton(e)}`;
        const feeHtml = `<p><strong>Entry:</strong> ${escapeHtml(getEventFeeLabel(e))}</p>`;
        if (e.date) {
            const d = new Date(e.date);
            const diff = d - now;
            statusText = `<p><strong>Date:</strong> ${d.toLocaleDateString()}</p>`;
            if (diff > 0) {
                const days = Math.floor(diff / (1000*60*60*24));
                countdownHtml = `<p><em>Starts in ${days} day${days!==1?'s':''}</em></p>`;
                eventTypeBadge = '<span class="event-status-badge upcoming-badge">Upcoming</span>';
            } else {
                eventTypeBadge = '<span class="event-status-badge closed-badge">Closed</span>';
            }
        }
        card.innerHTML = `
            <div class="event-card-top">
                ${eventTypeBadge}
            </div>
            <h3>${e.title}</h3>
            <p>${e.desc}</p>
            ${statusText}
            ${feeHtml}
            ${countdownHtml}
            <div class="event-card-actions">
                ${actionHtml}
            </div>
        `;
        container.appendChild(card);

        if (listView) {
            const row = document.createElement('div');
            row.className = 'simple-event-row';
            row.innerHTML = `
                <div class="simple-event-copy">
                    <h4>${e.title}</h4>
                    <p>${e.desc}</p>
                    <p><strong>Date:</strong> ${e.date ? new Date(e.date).toLocaleDateString() : 'TBA'}</p>
                    <p><strong>Entry:</strong> ${escapeHtml(getEventFeeLabel(e))}</p>
                </div>
                <div class="simple-event-action">
                    ${actionHtml}
                </div>
            `;
            listView.appendChild(row);
        }
    });
}

function renderUpcomingPreview() {
    const listView = document.getElementById('dashboardUpcomingList');
    if (!listView) return;

    const upcoming = events
        .filter(isUpcomingEvent)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    listView.innerHTML = '';
    if (!upcoming.length) {
        listView.innerHTML = '<p>No upcoming events are open right now.</p>';
        return;
    }

    const user = getCurrentUser();
    upcoming.forEach(event => {
        const row = document.createElement('div');
        row.className = 'simple-event-row';
        row.innerHTML = `
            <div class="simple-event-copy">
                <h4>${event.title}</h4>
                <p>${event.desc}</p>
                <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
                <p><strong>Entry:</strong> ${escapeHtml(getEventFeeLabel(event))}</p>
            </div>
            <div class="simple-event-action">
                ${getEventActionButton(event, user.username)}
                ${getOpenChatButton(event)}
            </div>
        `;
        listView.appendChild(row);
    });
}

function renderDashboardEventsPreview() {
    const listView = document.getElementById('dashboardEventsList');
    if (listView) listView.innerHTML = '';
    if (!listView) return;

    const sortedEvents = [...events]
        .sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(a.date) - new Date(b.date);
        });

    if (!sortedEvents.length) {
        listView.innerHTML = '<p>No events available right now.</p>';
        return;
    }

    const user = getCurrentUser();

    sortedEvents.forEach(event => {
        const row = document.createElement('div');
        row.className = 'simple-event-row';
        row.innerHTML = `
            <div class="simple-event-copy">
                <h4>${event.title}</h4>
                <p>${event.desc}</p>
                <p><strong>Date:</strong> ${event.date ? new Date(event.date).toLocaleDateString() : 'TBA'}</p>
                <p><strong>Entry:</strong> ${escapeHtml(getEventFeeLabel(event))}</p>
            </div>
            <div class="simple-event-action">
                ${getEventActionButton(event, user.username)}
                ${getOpenChatButton(event)}
            </div>
        `;
        listView.appendChild(row);
    });
}

function renderRecommendations() {
    const listView = document.getElementById('recommendedEventsList');
    if (!listView) return;
    listView.innerHTML = '';

    const user = getCurrentUser();
    const userRegs = registrations[user.username] || [];
    const categoryScores = { tech: 0, sports: 0, cultural: 0 };
    const categoryExamples = { tech: [], sports: [], cultural: [] };

    getProfileInterestCategories().forEach(category => {
        categoryScores[category] += 2;
    });

    userRegs.forEach(reg => {
        const event = events.find(item => item.id === reg.eventId);
        if (!event) return;
        getEventCategories(event).forEach(category => {
            categoryScores[category] += 3;
            categoryExamples[category].push(event.title);
        });
    });

    const recommendations = events
        .filter(event => isUpcomingEvent(event) && !isRegisteredForEvent(user.username, event.id))
        .map(event => {
            const categories = getEventCategories(event);
            const score = categories.reduce((sum, category) => sum + (categoryScores[category] || 0), 0);
            let reason = 'Recommended because it is a strong upcoming event.';
            const matchedCategory = categories.find(category => categoryScores[category] > 0);

            if (matchedCategory && categoryExamples[matchedCategory].length) {
                reason = `You attended ${categoryExamples[matchedCategory][0]} before, so this ${matchedCategory} event is a good next pick.`;
            } else if (matchedCategory) {
                reason = `Matches your ${matchedCategory} interest.`;
            } else if (categories.length) {
                reason = `Good match if you enjoy ${categories[0]} events.`;
            }

            return { event, score, reason };
        })
        .sort((a, b) => (b.score - a.score) || (new Date(a.event.date) - new Date(b.event.date)))
        .slice(0, 5);

    if (!recommendations.length) {
        listView.innerHTML = '<p>No personalized recommendations yet. Join a few events and I will suggest more like them.</p>';
        return;
    }

    recommendations.forEach(({ event, reason }) => {
        const row = document.createElement('div');
        row.className = 'simple-event-row recommended-row';
        row.innerHTML = `
            <div class="simple-event-copy">
                <h4>${event.title}</h4>
                <p>${event.desc}</p>
                <p><strong>Date:</strong> ${event.date ? new Date(event.date).toLocaleDateString() : 'TBA'}</p>
                <p><strong>Entry:</strong> ${escapeHtml(getEventFeeLabel(event))}</p>
                <p class="recommendation-reason"><strong>Why this fits you:</strong> ${reason}</p>
            </div>
            <div class="simple-event-action">
                ${getEventActionButton(event, user.username)}
                ${getOpenChatButton(event)}
            </div>
        `;
        listView.appendChild(row);
    });
}

function setHomeTab(tab) {
    homeTab = ['upcoming', 'recommended', 'all'].includes(tab) ? tab : 'upcoming';

    document.querySelectorAll('.home-tab-btn').forEach(button => {
        const isActive = button.dataset.homeTab === homeTab;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.home-tab-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.homePanel !== homeTab);
    });

    const homePanelTitle = document.getElementById('homePanelTitle');
    if (homePanelTitle) {
        const titleMap = {
            upcoming: 'Upcoming Events',
            recommended: 'Smart Recommendations',
            all: 'All Events'
        };
        homePanelTitle.textContent = titleMap[homeTab];
    }

    const viewUpcomingBtn = document.getElementById('viewUpcomingBtn');
    if (viewUpcomingBtn) {
        viewUpcomingBtn.classList.toggle('hidden', homeTab !== 'upcoming');
    }
}

function getAvailableChatEvents() {
    return events
        .filter(event => isUpcomingEvent(event))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderChatEventOptions() {
    const select = document.getElementById('chatEventSelect');
    if (!select) return;

    const chatEvents = getAvailableChatEvents();
    if (!chatEvents.length) {
        selectedChatEventId = null;
        select.innerHTML = '<option value="">No upcoming event groups</option>';
        select.disabled = true;
        return;
    }

    if (!chatEvents.some(event => event.id === selectedChatEventId)) {
        selectedChatEventId = chatEvents[0].id;
    }

    select.disabled = false;
    select.innerHTML = chatEvents.map(event => {
        const isSelected = event.id === selectedChatEventId ? 'selected' : '';
        return `<option value="${event.id}" ${isSelected}>${escapeHtml(event.title)} - ${new Date(event.date).toLocaleDateString()}</option>`;
    }).join('');
}

async function syncChatRoomSelection() {
    renderChatEventOptions();
    if (selectedChatEventId) {
        await loadEventChat(selectedChatEventId);
    } else {
        chatMessages = [];
    }
    renderChatRoom();
}

function renderChatRoom() {
    const feed = document.getElementById('chatRoomFeed');
    const input = document.getElementById('chatRoomInput');
    const form = document.getElementById('chatRoomForm');
    if (!feed) return;

    const selectedEvent = events.find(event => event.id === selectedChatEventId);
    if (!selectedEvent) {
        feed.innerHTML = '<p class="chat-room-empty">No upcoming event chat is available right now.</p>';
        if (input) input.disabled = true;
        if (form) form.classList.add('chat-room-disabled');
        return;
    }

    if (input) input.disabled = false;
    if (form) form.classList.remove('chat-room-disabled');

    if (!chatMessages.length) {
        feed.innerHTML = `
            <div class="chat-room-empty">
                <h4>${escapeHtml(selectedEvent.title)} group is open</h4>
                <p>Start the conversation, ask doubts, or find teammates for this event.</p>
            </div>
        `;
        return;
    }

    feed.innerHTML = chatMessages.map(message => {
        const mine = message.username === getCurrentUser().username ? 'mine' : '';
        const when = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
        return `
            <div class="chat-room-message ${mine}">
                <div class="chat-room-meta">
                    <strong>${escapeHtml(message.fullname || message.username)}</strong>
                    <span>@${escapeHtml(message.username || 'user')}</span>
                    <time>${escapeHtml(when)}</time>
                </div>
                <p>${escapeHtml(message.message)}</p>
            </div>
        `;
    }).join('');

    feed.scrollTop = feed.scrollHeight;
}

async function openEventChat(eventId) {
    selectedChatEventId = Number(eventId);
    renderChatEventOptions();
    await loadEventChat(selectedChatEventId);
    renderChatRoom();
    showSection('chatroom');
}

async function renderRegistrations() {
    const user = getCurrentUser();
    const list = document.getElementById('myRegs');
    const listView = document.getElementById('myRegsList');
    if (!list) return;
    if (listView) listView.innerHTML = '';
    const userRegs = [...(registrations[user.username] || [])].sort((a, b) => {
        const eventA = events.find(ev => ev.id === a.eventId);
        const eventB = events.find(ev => ev.id === b.eventId);
        const dateA = eventA && eventA.date ? new Date(eventA.date).getTime() : Number.MAX_SAFE_INTEGER;
        const dateB = eventB && eventB.date ? new Date(eventB.date).getTime() : Number.MAX_SAFE_INTEGER;
        return dateA - dateB;
    });
    list.innerHTML = '';
    if (userRegs.length === 0) {
        list.innerHTML = '<p>You have not registered for any events.</p>';
        if (listView) listView.innerHTML = '<p>You have not registered for any events.</p>';
        return;
    }
    userRegs.forEach(r => {
        const e = events.find(ev=>ev.id===r.eventId) || {title:'Unknown', desc:'', date:''};
        const item = document.createElement('div');
        item.className = 'event-card reveal active';
        const registeredAt = r.registeredAt || r.time;
        const statusLabel = r.status || 'registered';
        item.innerHTML = `
            <div class="event-card-top">
                <span class="event-status-badge ${r.status === 'pending_approval' ? 'draft-badge' : 'upcoming-badge'}">${statusLabel}</span>
            </div>
            <h3>${e.title}</h3>
            <p>${e.desc}</p>
            <p><strong>Date:</strong> ${e.date ? new Date(e.date).toLocaleDateString() : 'TBA'}</p>
            <p><strong>Pass Code:</strong> ${r.code || 'Pending'}</p>
            <p><strong>Status:</strong> ${r.status || 'registered'}</p>
            <p><strong>Joined On:</strong> ${registeredAt ? new Date(registeredAt).toLocaleString() : '-'}</p>
        `;
        list.appendChild(item);

        if (listView) {
            const row = document.createElement('div');
            row.className = 'simple-event-row';
            row.innerHTML = `
                <div class="simple-event-copy">
                    <h4>${e.title}</h4>
                    <p>${e.desc}</p>
                    <p><strong>Date:</strong> ${e.date ? new Date(e.date).toLocaleDateString() : 'TBA'}</p>
                    <p><strong>Pass Code:</strong> ${r.code || 'Pending'}</p>
                </div>
                <div class="simple-event-action">
                    <button class="card-btn ripple join-btn" disabled>${statusLabel}</button>
                </div>
            `;
            listView.appendChild(row);
        }
    });
}

function generateCode() {
    return Math.random().toString(36).substr(2,8).toUpperCase();
}

async function registerEvent(i) {
    if (!events[i]) return;
    return registerEventById(events[i].id);
}

async function registerEventById(eventId) {
    const user = getCurrentUser();
    if (!user.username) return alert('Please login to participate.');

    const event = events.find(item => item.id === eventId);
    if (!event) return alert('Event not found.');
    if (!isUpcomingEvent(event)) return alert('You can only participate in upcoming events.');
    if (isRegisteredForEvent(user.username, eventId)) return alert('You are already participating in this event.');

    try {
        await addRegistration(user.username, eventId);
        await loadRegistrations(user.username);
        renderEvents();
        renderUpcomingPreview();
        renderRecommendations();
        renderDashboardEventsPreview();
        renderRegistrations();
        renderAnalytics();
        addNotification(`Participation confirmed for ${event.title}.`);
        alert(`Participation confirmed for ${event.title}`);
    } catch (error) {
        alert(error.message || 'Unable to register for the event.');
    }
}

// profile form handling
async function showProfile() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.username) return;
    
    const profile = await loadCurrentProfile(user.username);
    const overview = document.getElementById('profileOverview');
    if (!overview) return;
    
    // Show photo if exists
    const photoEl = document.getElementById('profilePhoto');
    if (photoEl) {
        if (profile.photo) {
            photoEl.src = profile.photo;
            photoEl.classList.remove('hidden');
        } else {
            photoEl.classList.add('hidden');
        }
    }
    
    // Populate overview fields
    const ovName = document.getElementById('ovName');
    if (ovName) ovName.textContent = profile.fullname || user.fullname || '-';
    
    const ovUser = document.getElementById('ovUser');
    if (ovUser) ovUser.textContent = user.username;
    
    const ovEmail = document.getElementById('ovEmail');
    if (ovEmail) ovEmail.textContent = user.email || '-';
    
    const ovPhone = document.getElementById('ovPhone');
    if (ovPhone) ovPhone.textContent = user.phone || '-';
    
    // Show resume link if exists
    const ovResume = document.getElementById('ovResume');
    if (ovResume) {
        if (profile.resume) {
            ovResume.href = profile.resume;
            ovResume.classList.remove('hidden');
            ovResume.download = profile.resumeFileName || 'resume.pdf';
        } else {
            ovResume.classList.add('hidden');
        }
    }
    
    // Populate form fields
    const pfName = document.getElementById('pfName');
    if (pfName) pfName.value = profile.fullname || user.fullname || '';
    
    const pfUser = document.getElementById('pfUser');
    if (pfUser) pfUser.value = user.username;
    
    const pfEmail = document.getElementById('pfEmail');
    if (pfEmail) pfEmail.value = user.email || '';
    
    const pfPhone = document.getElementById('pfPhone');
    if (pfPhone) pfPhone.value = user.phone || '';
}

function handleProfileForm(e) {
    e.preventDefault();
    const profile = {};
    profile.username = document.getElementById('pfUser').value;
    profile.fullname = document.getElementById('pfName').value;
    Promise.resolve().then(async ()=>{
        await saveProfile(profile);
        alert('Profile updated!');
        showProfile();
    });
}

// calendar, analytics, notifications render functions remain unchanged... (above omitted for brevity)

// utility to switch visible section
function showSection(id) {
    document.querySelectorAll('.main-content .section').forEach(sec => {
        sec.classList.toggle('hidden', sec.id !== id);
    });
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.classList.toggle('active', link.dataset.section === id);
    });
    if (id === 'events' || id === 'manage') {
        renderEvents();
    }
    if (id === 'myregs') renderRegistrations();
    if (id === 'profile') showProfile();
    if (id === 'notifications') renderNotifications();
    if (id === 'analytics') renderAnalytics();
    if (id === 'support') renderTickets();
    if (id === 'chatroom') {
        syncChatRoomSelection();
    }
    if (id === 'home') {
        renderUpcomingPreview();
        renderRecommendations();
        renderDashboardEventsPreview();
        setHomeTab(homeTab);
    }
}

function setupNavigation() {
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            showSection(link.dataset.section);
        });
    });
}

function pushChatMessage(role, text) {
    const messages = document.getElementById('chatbotMessages');
    if (!messages) return;
    const item = document.createElement('div');
    item.className = `chatbot-message ${role}`;
    item.innerHTML = `<p>${escapeHtml(text)}</p>`;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
}

function getChatbotEventSummary() {
    const now = new Date();
    const upcoming = events.filter(event => event.date && new Date(event.date) >= now);
    const nearest = upcoming
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 3)
        .map(event => `${event.title} on ${new Date(event.date).toLocaleDateString()}`);
    return { upcoming, nearest };
}

function handleChatbotPrompt(rawPrompt) {
    const prompt = (rawPrompt || '').trim();
    if (!prompt) return;

    pushChatMessage('user', prompt);
    const normalized = prompt.toLowerCase();
    let reply = 'I can guide you to events, profile, support, analytics, and registrations.';
    const user = getCurrentUser();
    const userRegs = registrations[user.username] || [];
    const { upcoming, nearest } = getChatbotEventSummary();

    if (normalized.includes('upcoming')) {
        currentFilter = 'upcoming';
        showSection('events');
        reply = upcoming.length
            ? `I opened the Events section and filtered it to upcoming events. The next ones are ${nearest.join(', ')}.`
            : 'I opened the Events section, but there are no upcoming events right now.';
    } else if (normalized.includes('event') && (normalized.includes('available') || normalized.includes('list') || normalized.includes('show'))) {
        currentFilter = 'all';
        showSection('events');
        reply = `I opened the full Events section. There are ${events.length} visible events in your dashboard right now.`;
    } else if (normalized.includes('registration') || normalized.includes('my registrations')) {
        showSection('myregs');
        reply = userRegs.length
            ? `I opened My Registrations. You currently have ${userRegs.length} registered event${userRegs.length === 1 ? '' : 's'}.`
            : 'I opened My Registrations. You have not joined any events yet.';
    } else if (normalized.includes('join') || normalized.includes('participate')) {
        currentFilter = 'upcoming';
        showSection('events');
        reply = 'Open an upcoming event and click Join Event. After joining, it appears in My Registrations.';
    } else if (normalized.includes('nearest') || normalized.includes('next event')) {
        reply = nearest.length
            ? `Your nearest upcoming events are ${nearest.join(', ')}.`
            : 'There are no upcoming events available right now.';
    } else if (normalized.includes('how many') && normalized.includes('event')) {
        reply = `You can currently see ${events.length} events in total, and ${upcoming.length} of them are upcoming.`;
    } else if (normalized.includes('profile')) {
        showSection('profile');
        reply = 'I opened your Profile section.';
    } else if (normalized.includes('support') || normalized.includes('ticket')) {
        showSection('support');
        reply = 'I opened Support so you can create a ticket.';
    } else if (normalized.includes('analytics')) {
        showSection('analytics');
        reply = 'I opened Analytics for you.';
    } else if (normalized.includes('notification')) {
        showSection('notifications');
        reply = 'I opened Notifications.';
    } else if (normalized.includes('dashboard') || normalized.includes('home')) {
        showSection('home');
        reply = 'I brought you back to the dashboard home.';
    }

    pushChatMessage('assistant', reply);
}

function setupChatbot() {
    const form = document.getElementById('chatbotForm');
    const input = document.getElementById('chatbotInput');
    const chips = document.querySelectorAll('.chatbot-chip');
    const toggle = document.getElementById('chatbotToggle');
    const close = document.getElementById('chatbotClose');
    const drawer = document.getElementById('chatbotDrawer');
    const backdrop = document.getElementById('chatbotBackdrop');
    if (!form || !input) return;

    function setChatbotOpen(isOpen) {
        if (!drawer || !backdrop || !toggle) return;
        drawer.classList.toggle('open', isOpen);
        drawer.setAttribute('aria-hidden', String(!isOpen));
        backdrop.classList.toggle('hidden', !isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
            setTimeout(() => input.focus(), 50);
        }
    }

    const messages = document.getElementById('chatbotMessages');
    if (messages && !messages.children.length) {
        pushChatMessage('assistant', 'Hi, I am your AI guide. Ask me to show events, registrations, or explain how to join.');
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            const isOpen = drawer && drawer.classList.contains('open');
            setChatbotOpen(!isOpen);
        });
    }

    if (close) {
        close.addEventListener('click', () => setChatbotOpen(false));
    }

    if (backdrop) {
        backdrop.addEventListener('click', () => setChatbotOpen(false));
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            setChatbotOpen(false);
        }
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const prompt = input.value.trim();
        if (!prompt) return;
        input.value = '';
        handleChatbotPrompt(prompt);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.requestSubmit();
        }
    });

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.chatbotPrompt || chip.textContent || '';
            handleChatbotPrompt(prompt);
        });
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    const user = await requireAuthPage(['participant'], 'login.html');
    if (!user) return;

    setupNavigation();
    setupChatbot();
    showSection('home');

    if (user.username) {
        const welcome = document.getElementById('welcomeMsg');
        if (welcome) welcome.textContent = `Welcome, ${user.fullname||user.username}`;
        const sidebarUser = document.getElementById('sidebarUser');
        if (sidebarUser) sidebarUser.textContent = `${user.fullname||user.username}`;
        await loadRegistrations(user.username);
        await loadCurrentProfile(user.username);
    }
    await loadEvents();
    await loadTickets();
    await syncChatRoomSelection();
    renderUpcomingPreview();
    renderRecommendations();
    renderDashboardEventsPreview();
    setHomeTab('upcoming');
    renderEvents();
    showSection('home');
    showProfile();
    const profForm = document.getElementById('profileForm');
    if (profForm) profForm.addEventListener('submit', handleProfileForm);
    const manageLink = document.querySelector('.sidebar a[data-section="manage"]');
    if (manageLink) manageLink.parentElement.classList.add('hidden');
    const manageSection = document.getElementById('manage');
    if (manageSection) manageSection.classList.add('hidden');
    const viewUpcomingBtn = document.getElementById('viewUpcomingBtn');
    if (viewUpcomingBtn) {
        viewUpcomingBtn.addEventListener('click', () => {
            currentFilter = 'upcoming';
            showSection('events');
            const searchInput = document.getElementById('eventSearch');
            if (searchInput) searchInput.value = '';
            renderEvents();
        });
    }
    document.querySelectorAll('.home-tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            setHomeTab(button.dataset.homeTab);
        });
    });
    // search handler
    const searchInput = document.getElementById('eventSearch');
    function applySearch() {
        const q = searchInput.value.trim().toLowerCase();
        if (q === '') {
            renderEvents();
        } else {
            const filtered = events.filter(e => e.title.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q));
            renderEvents(filtered);
        }
    }
    if (searchInput) {
        searchInput.addEventListener('keyup', applySearch);
    }
    // filter buttons
    const upBtn = document.getElementById('filterUpcoming');
    const pastBtn = document.getElementById('filterPast');
    const allBtn = document.getElementById('filterAll');
    if (allBtn) {
        allBtn.addEventListener('click', () => { currentFilter = 'all'; applySearch(); });
    }
    if (upBtn && pastBtn) {
        upBtn.addEventListener('click', () => { currentFilter = 'upcoming'; applySearch(); });
        pastBtn.addEventListener('click', () => { currentFilter = 'past'; applySearch(); });
    }

    document.getElementById('logoutLink').addEventListener('click', () => {
        logoutAndRedirect('login.html');
    });
    // theme toggle
    const themeBtn = document.getElementById('themeToggle');
    function applyTheme(t) {
        if (t === 'dark') document.body.classList.add('dark');
        else document.body.classList.remove('dark');
        if (themeBtn) themeBtn.textContent = t === 'dark' ? 'Light Mode' : 'Dark Mode';
        localStorage.setItem('theme', t);
    }
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
            applyTheme(newTheme);
        });
    }
    // ticket form
    const ticketForm = document.getElementById('ticketForm');
    if (ticketForm) {
        ticketForm.addEventListener('submit', e => {
            e.preventDefault();
            const msg = document.getElementById('ticketMsg').value.trim();
            if (msg) {
                createTicket(msg, user.username || 'guest')
                    .then(() => renderTickets())
                    .catch(err => alert(err.message));
                document.getElementById('ticketMsg').value = '';
            }
        });
    }

    const chatEventSelect = document.getElementById('chatEventSelect');
    if (chatEventSelect) {
        chatEventSelect.addEventListener('change', async e => {
            selectedChatEventId = Number(e.target.value) || null;
            await loadEventChat(selectedChatEventId);
            renderChatRoom();
        });
    }

    const chatRoomForm = document.getElementById('chatRoomForm');
    const chatRoomInput = document.getElementById('chatRoomInput');
    if (chatRoomForm && chatRoomInput) {
        chatRoomForm.addEventListener('submit', async e => {
            e.preventDefault();
            const message = chatRoomInput.value.trim();
            if (!selectedChatEventId) {
                alert('Please choose an event group first.');
                return;
            }
            if (!message) return;
            try {
                await sendEventChatMessage(selectedChatEventId, message);
                chatRoomInput.value = '';
                renderChatRoom();
            } catch (error) {
                alert(error.message || 'Unable to send chat message.');
            }
        });
    }

});

// analytics display
function renderAnalytics() {
    const cards = document.getElementById('analyticsCards');
    const detail = document.getElementById('analyticsDetail');
    if (!cards || !detail) return;
    const total = events.length;
    const now = new Date();
    const upcoming = events.filter(e => e.date && new Date(e.date) >= now).length;
    const past = events.filter(e => e.date && new Date(e.date) < now).length;
    const user = getCurrentUser();
    const regs = (registrations[user.username] || []).length;
    const pending = (registrations[user.username] || []).filter(reg => reg.status === 'pending_approval').length;
    cards.innerHTML = '';
    detail.innerHTML = '';
    const items = [
        {
            label: 'Total Events',
            value: total,
            title: 'Total Events Overview',
            description: 'This counts every event currently listed in your dashboard.',
            extra: `You currently have ${total} total event${total === 1 ? '' : 's'} available to review.`
        },
        {
            label: 'Upcoming',
            value: upcoming,
            title: 'Upcoming Events',
            description: 'These are the events scheduled for today or later.',
            extra: upcoming
                ? `There ${upcoming === 1 ? 'is' : 'are'} ${upcoming} upcoming event${upcoming === 1 ? '' : 's'} you can explore or join.`
                : 'There are no upcoming events available right now.'
        },
        {
            label: 'Past',
            value: past,
            title: 'Past Events',
            description: 'These events already took place and remain for reference.',
            extra: past
                ? `The dashboard currently shows ${past} completed event${past === 1 ? '' : 's'}.`
                : 'No past events are listed yet.'
        },
        {
            label: 'My Registrations',
            value: regs,
            title: 'My Registration Activity',
            description: 'This shows how many events you have joined with your account.',
            extra: regs
                ? `You have registered for ${regs} event${regs === 1 ? '' : 's'}. Open My Registrations to see the details.`
                : 'You have not registered for any events yet.'
        },
        {
            label: 'Pending Approval',
            value: pending,
            title: 'Pending Approvals',
            description: 'These registrations are waiting for confirmation.',
            extra: pending
                ? `${pending} registration request${pending === 1 ? ' is' : 's are'} still pending approval.`
                : 'You do not have any pending approvals right now.'
        }
    ];

    function showAnalyticsDetail(item) {
        detail.innerHTML = `
            <h3>${item.title}</h3>
            <p><strong>Count:</strong> ${item.value}</p>
            <p>${item.description}</p>
            <p>${item.extra}</p>
        `;
    }

    items.forEach((it, index) => {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `<h4>${it.value}</h4><p>${it.label}</p>`;
        card.addEventListener('click', () => {
            document.querySelectorAll('#analyticsCards .metric-card').forEach(node => node.classList.remove('active'));
            card.classList.add('active');
            showAnalyticsDetail(it);
        });
        cards.appendChild(card);

        if (index === 0) {
            card.classList.add('active');
            showAnalyticsDetail(it);
        }
    });
}



