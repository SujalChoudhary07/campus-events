/*
  Organizer dashboard script
*/

let events = [];
let users = [];
let registrations = [];
let currentUser = null;
let editingEventId = null;

const state = {
    eventSearch: '',
    eventStatus: 'all',
    eventSort: 'soonest',
    participantSearch: '',
    participantEventFilter: 'all'
};

async function api(path, opts = {}) {
    const res = await apiFetch('/api' + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function loadEvents() {
    try {
        events = await api('/events');
    } catch (e) {
        console.error('loadEvents error', e);
        events = [];
    }
}

async function createEvent(eventData) {
    const newEvent = await api('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    });
    events.push(newEvent);
    return newEvent;
}

async function updateEventObj(id, eventData) {
    await api(`/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    });
    await loadEvents();
}

async function deleteEventObj(id) {
    await api(`/events/${id}`, { method: 'DELETE' });
    await loadEvents();
}

async function loadUsers() {
    try {
        users = await api('/users');
    } catch (e) {
        console.error('loadUsers error', e);
        users = [];
    }
}

async function loadRegistrations() {
    try {
        registrations = await api('/registrations');
    } catch (e) {
        console.error('loadRegs error', e);
        registrations = [];
    }
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function normalizeEvent(event) {
    return {
        id: event.id,
        title: event.title || 'Untitled Event',
        desc: event.desc || '',
        date: event.date || '',
        time: event.time || '',
        venue: event.venue || '',
        capacity: String(event.capacity || '').trim(),
        category: event.category || 'Other',
        status: getComputedStatus(event),
        owner: event.owner || '',
        notes: event.notes || ''
    };
}

function getComputedStatus(event) {
    const explicitStatus = String(event.status || '').toLowerCase();
    if (explicitStatus) return explicitStatus;

    const eventDate = parseEventDate(event);
    if (!eventDate) return 'draft';
    return eventDate < startOfToday() ? 'completed' : 'upcoming';
}

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function parseEventDate(event) {
    if (!event || !event.date) return null;
    const parsed = new Date(event.date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDate(dateString) {
    if (!dateString) return 'Date pending';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return dateString;
    return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(value) {
    if (!value) return 'Not available';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatStatusLabel(status) {
    const clean = String(status || 'draft').toLowerCase().replace(/_/g, ' ');
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function getStatusBadgeClass(status) {
    const clean = String(status || 'draft').toLowerCase();
    if (clean === 'upcoming') return 'upcoming-badge';
    if (clean === 'completed') return 'closed-badge';
    if (clean === 'live') return 'live-badge';
    return 'draft-badge';
}

function getRegistrationsForEvent(eventId) {
    return registrations.filter(reg => Number(reg.eventId) === Number(eventId));
}

function getRegistrationCount(eventId) {
    return getRegistrationsForEvent(eventId).length;
}

function getCapacityValue(event) {
    const capacity = Number.parseInt(String(event.capacity || '').trim(), 10);
    return Number.isFinite(capacity) && capacity > 0 ? capacity : null;
}

function getFillRate(event) {
    const capacity = getCapacityValue(event);
    if (!capacity) return null;
    const count = getRegistrationCount(event.id);
    return Math.min(100, Math.round((count / capacity) * 100));
}

function getUpcomingEvents() {
    return events
        .map(normalizeEvent)
        .filter(event => {
            const date = parseEventDate(event);
            return date && date >= startOfToday() && event.status !== 'completed';
        })
        .sort((a, b) => parseEventDate(a) - parseEventDate(b));
}

function getFilteredEvents() {
    const search = state.eventSearch.toLowerCase();

    return events
        .map(normalizeEvent)
        .filter(event => {
            const matchesSearch = !search || [
                event.title,
                event.desc,
                event.category,
                event.venue,
                event.owner
            ].some(value => String(value || '').toLowerCase().includes(search));

            const matchesStatus = state.eventStatus === 'all' || event.status === state.eventStatus;
            return matchesSearch && matchesStatus;
        })
        .sort((a, b) => {
            if (state.eventSort === 'latest') {
                return (parseEventDate(b)?.getTime() || 0) - (parseEventDate(a)?.getTime() || 0);
            }
            if (state.eventSort === 'registrations') {
                return getRegistrationCount(b.id) - getRegistrationCount(a.id);
            }
            if (state.eventSort === 'title') {
                return a.title.localeCompare(b.title);
            }
            return (parseEventDate(a)?.getTime() || Number.MAX_SAFE_INTEGER) - (parseEventDate(b)?.getTime() || Number.MAX_SAFE_INTEGER);
        });
}

function getParticipantRows() {
    const search = state.participantSearch.toLowerCase();

    return registrations
        .map(registration => {
            const user = users.find(item => item.username === registration.username) || {};
            const event = events.find(item => Number(item.id) === Number(registration.eventId)) || {};
            return {
                username: registration.username,
                fullname: user.fullname || registration.username,
                email: user.email || 'Not provided',
                eventId: registration.eventId,
                eventTitle: event.title || 'Unknown event',
                eventDate: event.date || '',
                code: registration.code || '-',
                registeredAt: registration.registeredAt || registration.time || '',
                status: registration.status || 'registered'
            };
        })
        .filter(row => {
            const matchesEvent = state.participantEventFilter === 'all' || String(row.eventId) === state.participantEventFilter;
            const matchesSearch = !search || [
                row.fullname,
                row.email,
                row.username,
                row.eventTitle
            ].some(value => String(value || '').toLowerCase().includes(search));
            return matchesEvent && matchesSearch;
        })
        .sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0));
}

function renderOverview() {
    const stats = document.getElementById('overviewStats');
    const schedulePanel = document.getElementById('schedulePanel');
    const focusPanel = document.getElementById('focusPanel');
    const heroSummary = document.getElementById('heroSummary');

    const totalEvents = events.length;
    const totalRegs = registrations.length;
    const pendingApprovals = registrations.filter(reg => reg.status === 'pending_approval').length;
    const upcomingEvents = getUpcomingEvents();
    const liveCount = events.map(normalizeEvent).filter(event => event.status === 'live').length;
    const completionRate = totalEvents ? Math.round((totalRegs / totalEvents) * 10) / 10 : 0;

    stats.innerHTML = [
        { label: 'Total events', value: totalEvents, note: 'All events in the system' },
        { label: 'Registrations', value: totalRegs, note: 'Confirmed participant signups' },
        { label: 'Upcoming', value: upcomingEvents.length, note: 'Still ahead on the calendar' },
        { label: 'Pending approvals', value: pendingApprovals, note: `Live: ${liveCount} • Avg. ${completionRate} registrations per event` }
    ].map(item => `
        <div class="metric-card organizer-stat-card">
            <h4>${escapeHtml(item.value)}</h4>
            <p>${escapeHtml(item.label)}</p>
            <span>${escapeHtml(item.note)}</span>
        </div>
    `).join('');

    if (heroSummary) {
        const nextEvent = upcomingEvents[0];
        heroSummary.textContent = nextEvent
            ? `Next event: ${nextEvent.title} on ${formatEventDate(nextEvent.date)}${nextEvent.time ? ` at ${nextEvent.time}` : ''}.`
            : 'Track upcoming events, registrations, and execution readiness in one place.';
    }

    if (!upcomingEvents.length) {
        schedulePanel.innerHTML = '<div class="timeline-empty subtle-text">No upcoming events yet. Create one to start your schedule.</div>';
    } else {
        schedulePanel.innerHTML = upcomingEvents.slice(0, 5).map(event => `
            <article class="timeline-item">
                <div class="timeline-date">${escapeHtml(formatEventDate(event.date))}</div>
                <div class="timeline-copy">
                    <h4>${escapeHtml(event.title)}</h4>
                    <p>${escapeHtml(event.venue || 'Venue to be announced')}</p>
                    <span>${escapeHtml(event.time || 'Time pending')} • ${getRegistrationCount(event.id)} registrations</span>
                </div>
            </article>
        `).join('');
    }

    const focusItems = events
        .map(normalizeEvent)
        .map(event => {
            const count = getRegistrationCount(event.id);
            const fillRate = getFillRate(event);
            let message = 'Ready for review.';

            if (event.status === 'draft') message = 'Still in draft. Publish details when ready.';
            else if (event.status === 'live') message = 'Live event. Monitor participant activity closely.';
            else if (fillRate !== null && fillRate >= 85) message = 'Nearly full. Consider waitlist messaging.';
            else if (count === 0 && event.status === 'upcoming') message = 'No registrations yet. Promotion may be needed.';

            return { event, message, count };
        })
        .sort((a, b) => {
            if (a.event.status === 'draft' && b.event.status !== 'draft') return -1;
            if (a.count === 0 && b.count > 0) return -1;
            return 0;
        })
        .slice(0, 4);

    focusPanel.innerHTML = focusItems.length
        ? focusItems.map(item => `
            <div class="focus-item">
                <div class="focus-item-head">
                    <h4>${escapeHtml(item.event.title)}</h4>
                    <span class="event-status-badge ${getStatusBadgeClass(item.event.status)}">${escapeHtml(formatStatusLabel(item.event.status))}</span>
                </div>
                <p>${escapeHtml(item.message)}</p>
            </div>
        `).join('')
        : '<div class="timeline-empty subtle-text">Nothing urgent right now. Your dashboard will highlight issues here.</div>';
}

function renderEvents() {
    const container = document.getElementById('eventContainer');
    const emptyState = document.getElementById('eventEmptyState');
    const filteredEvents = getFilteredEvents();

    emptyState.classList.toggle('hidden', filteredEvents.length > 0);
    container.innerHTML = '';

    filteredEvents.forEach(event => {
        const card = document.createElement('article');
        const registrationCount = getRegistrationCount(event.id);
        const fillRate = getFillRate(event);
        const capacity = getCapacityValue(event);

        card.className = 'event-card organizer-event-card reveal active';
        card.innerHTML = `
            <div class="event-card-top">
                <span class="event-status-badge ${getStatusBadgeClass(event.status)}">${escapeHtml(formatStatusLabel(event.status))}</span>
            </div>
            <div class="organizer-event-meta">
                <span>${escapeHtml(event.category)}</span>
                <span>${escapeHtml(formatEventDate(event.date))}</span>
            </div>
            <h3>${escapeHtml(event.title)}</h3>
            <p>${escapeHtml(event.desc || 'No description provided.')}</p>
            <div class="organizer-key-values">
                <div><strong>Venue</strong><span>${escapeHtml(event.venue || 'TBA')}</span></div>
                <div><strong>Time</strong><span>${escapeHtml(event.time || 'Pending')}</span></div>
                <div><strong>Coordinator</strong><span>${escapeHtml(event.owner || (currentUser?.fullname || currentUser?.username || 'Unassigned'))}</span></div>
                <div><strong>Registrations</strong><span>${registrationCount}${capacity ? ` / ${capacity}` : ''}</span></div>
            </div>
            <div class="organizer-progress-block">
                <div class="organizer-progress-label">
                    <span>Capacity usage</span>
                    <span>${fillRate === null ? 'No capacity set' : `${fillRate}% filled`}</span>
                </div>
                <div class="organizer-progress-bar">
                    <span style="width: ${fillRate === null ? 12 : fillRate}%;"></span>
                </div>
            </div>
            ${event.notes ? `<div class="organizer-notes"><strong>Notes:</strong> ${escapeHtml(event.notes)}</div>` : ''}
            <div class="event-card-actions organizer-card-actions">
                <button class="card-btn ripple" type="button" data-action="edit" data-id="${event.id}">Edit</button>
                <button class="card-btn ripple" type="button" data-action="duplicate" data-id="${event.id}">Duplicate</button>
                <button class="card-btn ripple" type="button" data-action="delete" data-id="${event.id}">Delete</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderParticipants() {
    const container = document.getElementById('participantList');
    const summary = document.getElementById('participantSummary');
    const rows = getParticipantRows();

    summary.innerHTML = `
        <div class="metric-card organizer-mini-card">
            <h4>${rows.length}</h4>
            <p>Visible registrations</p>
        </div>
        <div class="metric-card organizer-mini-card">
            <h4>${new Set(rows.map(row => row.eventId)).size}</h4>
            <p>Events represented</p>
        </div>
        <div class="metric-card organizer-mini-card">
            <h4>${new Set(rows.map(row => row.username)).size}</h4>
            <p>Unique participants</p>
        </div>
        <div class="metric-card organizer-mini-card">
            <h4>${rows.filter(row => row.status === 'pending_approval').length}</h4>
            <p>Pending approvals</p>
        </div>
    `;

    if (!rows.length) {
        container.innerHTML = '<div class="table-empty">No participants match the current search or event filter.</div>';
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Code</th>
                    <th>Registered</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td>${escapeHtml(row.fullname)}</td>
                        <td>${escapeHtml(row.email)}</td>
                        <td>${escapeHtml(row.eventTitle)}</td>
                        <td>${escapeHtml(formatStatusLabel(row.status.replace('_', ' ')).replace('approval', 'Approval'))}</td>
                        <td>${escapeHtml(row.code)}</td>
                        <td>${escapeHtml(formatDateTime(row.registeredAt))}</td>
                        <td>
                            ${row.status === 'pending_approval'
                                ? `<div class="table-action-group">
                                    <button class="btn-secondary participant-action-btn" type="button" data-action="approve" data-event-id="${row.eventId}" data-username="${escapeHtml(row.username)}">Approve</button>
                                    <button class="btn-ghost participant-action-btn" type="button" data-action="reject" data-event-id="${row.eventId}" data-username="${escapeHtml(row.username)}">Reject</button>
                                </div>`
                                : `<span class="subtle-text">${row.status === 'registered' ? 'Completed' : 'Reviewed'}</span>`
                            }
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderParticipantEventOptions() {
    const select = document.getElementById('participantEventFilter');
    const currentValue = state.participantEventFilter;
    const options = [
        '<option value="all">All events</option>',
        ...events
            .map(normalizeEvent)
            .sort((a, b) => a.title.localeCompare(b.title))
            .map(event => `<option value="${event.id}">${escapeHtml(event.title)}</option>`)
    ];
    select.innerHTML = options.join('');
    select.value = currentValue;
}

function renderAnalytics() {
    const cards = document.getElementById('analyticsCards');
    const performance = document.getElementById('analyticsPerformance');
    const categoryBreakdown = document.getElementById('analyticsCategoryBreakdown');

    const totalEvents = events.length;
    const totalRegs = registrations.length;
    const averageRegs = totalEvents ? (totalRegs / totalEvents).toFixed(1) : '0.0';
    const draftEvents = events.map(normalizeEvent).filter(event => event.status === 'draft').length;
    const categories = {};

    events.map(normalizeEvent).forEach(event => {
        categories[event.category] = (categories[event.category] || 0) + 1;
    });

    cards.innerHTML = [
        { label: 'Total Events', value: totalEvents, note: 'Published and draft events' },
        { label: 'Registrations', value: totalRegs, note: 'All confirmed signups' },
        { label: 'Avg / Event', value: averageRegs, note: 'Average registrations per event' },
        { label: 'Draft Events', value: draftEvents, note: 'Need publishing or review' }
    ].map(item => `
        <div class="metric-card organizer-stat-card">
            <h4>${escapeHtml(item.value)}</h4>
            <p>${escapeHtml(item.label)}</p>
            <span>${escapeHtml(item.note)}</span>
        </div>
    `).join('');

    const performanceItems = events
        .map(normalizeEvent)
        .sort((a, b) => getRegistrationCount(b.id) - getRegistrationCount(a.id))
        .slice(0, 6);

    performance.innerHTML = performanceItems.length
        ? performanceItems.map(event => {
            const count = getRegistrationCount(event.id);
            const fillRate = getFillRate(event);
            return `
                <div class="analytics-item">
                    <div class="analytics-item-head">
                        <h4>${escapeHtml(event.title)}</h4>
                        <span>${count} registrations</span>
                    </div>
                    <p>${escapeHtml(event.category)} • ${escapeHtml(formatEventDate(event.date))}</p>
                    <div class="organizer-progress-bar">
                        <span style="width: ${fillRate === null ? Math.min(100, count * 10 || 8) : fillRate}%;"></span>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="table-empty">Create events to start seeing performance trends.</div>';

    const categoryItems = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    categoryBreakdown.innerHTML = categoryItems.length
        ? categoryItems.map(([category, count]) => `
            <div class="analytics-item">
                <div class="analytics-item-head">
                    <h4>${escapeHtml(category)}</h4>
                    <span>${count} event${count === 1 ? '' : 's'}</span>
                </div>
                <div class="organizer-progress-bar">
                    <span style="width: ${Math.round((count / totalEvents) * 100)}%;"></span>
                </div>
            </div>
        `).join('')
        : '<div class="table-empty">No category data available yet.</div>';
}

function fillEventForm(event) {
    const normalized = normalizeEvent(event);
    document.getElementById('eventTitle').value = normalized.title;
    document.getElementById('eventCategory').value = normalized.category;
    document.getElementById('eventDate').value = normalized.date;
    document.getElementById('eventTime').value = normalized.time;
    document.getElementById('eventVenue').value = normalized.venue;
    document.getElementById('eventCapacity').value = normalized.capacity;
    document.getElementById('eventStatus').value = normalized.status;
    document.getElementById('eventOwner').value = normalized.owner;
    document.getElementById('eventDesc').value = normalized.desc;
    document.getElementById('eventNotes').value = normalized.notes;
}

function resetEventForm() {
    editingEventId = null;
    document.getElementById('eventForm').reset();
    document.getElementById('eventStatus').value = 'upcoming';
    document.getElementById('eventCategory').value = 'Conference';
    document.getElementById('eventFormTitle').textContent = 'Create Event';
    document.getElementById('eventFormSubtitle').textContent = 'Add all important planning details for your team.';
    document.getElementById('eventEditingBadge').classList.add('hidden');
    document.getElementById('cancelEventEditBtn').classList.add('hidden');
}

function openEventForm(mode = 'create') {
    const form = document.getElementById('eventForm');
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (mode === 'create') {
        resetEventForm();
    }
}

function closeEventForm() {
    document.getElementById('eventForm').classList.add('hidden');
    resetEventForm();
}

function populateEditMode(eventId) {
    const event = events.find(item => Number(item.id) === Number(eventId));
    if (!event) return;

    editingEventId = event.id;
    fillEventForm(event);
    document.getElementById('eventFormTitle').textContent = 'Edit Event';
    document.getElementById('eventFormSubtitle').textContent = 'Update the event details and keep the team aligned.';
    document.getElementById('eventEditingBadge').classList.remove('hidden');
    document.getElementById('cancelEventEditBtn').classList.remove('hidden');
    openEventForm('edit');
}

function getEventFormPayload() {
    const title = document.getElementById('eventTitle').value.trim();
    const desc = document.getElementById('eventDesc').value.trim();
    const date = document.getElementById('eventDate').value;

    if (!title || !desc || !date) {
        throw new Error('Please fill in the title, description, and date.');
    }

    return {
        title,
        desc,
        date,
        time: document.getElementById('eventTime').value.trim(),
        venue: document.getElementById('eventVenue').value.trim(),
        capacity: document.getElementById('eventCapacity').value.trim(),
        category: document.getElementById('eventCategory').value,
        status: document.getElementById('eventStatus').value,
        owner: document.getElementById('eventOwner').value.trim() || (currentUser?.fullname || currentUser?.username || ''),
        notes: document.getElementById('eventNotes').value.trim()
    };
}

async function updateRegistrationStatus(eventId, username, status) {
    await api(`/registrations/manage/${eventId}/${encodeURIComponent(username)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
}

function renderAll() {
    renderOverview();
    renderEvents();
    renderParticipantEventOptions();
    renderParticipants();
    renderAnalytics();
}

function showSection(id) {
    document.querySelectorAll('.main-content .section').forEach(sec => {
        sec.classList.toggle('hidden', sec.id !== id);
    });
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.classList.toggle('active', link.dataset.section === id);
    });
}

function setupNavigation() {
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            showSection(link.dataset.section);
        });
    });
}

function setupToolbarBindings() {
    document.getElementById('eventSearch').addEventListener('input', event => {
        state.eventSearch = event.target.value.trim();
        renderEvents();
    });

    document.getElementById('eventStatusFilter').addEventListener('change', event => {
        state.eventStatus = event.target.value;
        renderEvents();
    });

    document.getElementById('eventSort').addEventListener('change', event => {
        state.eventSort = event.target.value;
        renderEvents();
    });

    document.getElementById('participantSearch').addEventListener('input', event => {
        state.participantSearch = event.target.value.trim();
        renderParticipants();
    });

    document.getElementById('participantEventFilter').addEventListener('change', event => {
        state.participantEventFilter = event.target.value;
        renderParticipants();
    });
}

function setupEventActions() {
    document.getElementById('eventContainer').addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const eventId = Number(button.dataset.id);

        if (action === 'edit') {
            populateEditMode(eventId);
            return;
        }

        if (action === 'duplicate') {
            const source = events.find(item => Number(item.id) === eventId);
            if (!source) return;

            const copy = normalizeEvent(source);
            await createEvent({
                ...copy,
                title: `${copy.title} Copy`,
                status: 'draft'
            });
            await Promise.all([loadEvents(), loadRegistrations()]);
            renderAll();
            showSection('events');
            return;
        }

        if (action === 'delete') {
            const source = events.find(item => Number(item.id) === eventId);
            if (!source) return;

            const confirmed = confirm(`Delete "${source.title}"? This will also remove its registrations.`);
            if (!confirmed) return;

            await deleteEventObj(eventId);
            await loadRegistrations();
            if (editingEventId === eventId) closeEventForm();
            renderAll();
        }
    });
}

function setupParticipantActions() {
    document.getElementById('participantList').addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const eventId = Number(button.dataset.eventId);
        const username = button.dataset.username;
        if (!eventId || !username) return;

        try {
            await updateRegistrationStatus(eventId, username, action === 'approve' ? 'registered' : 'rejected');
            await loadRegistrations();
            renderAll();
        } catch (error) {
        alert(error.message || 'Unable to update the registration status.');
        }
    });
}

function setupFormActions() {
    document.getElementById('toggleEventFormBtn').addEventListener('click', () => openEventForm('create'));
    document.getElementById('jumpToCreateBtn').addEventListener('click', () => {
        showSection('events');
        openEventForm('create');
    });
    document.getElementById('refreshDashboardBtn').addEventListener('click', async () => {
        await Promise.all([loadEvents(), loadUsers(), loadRegistrations()]);
        renderAll();
    });
    document.getElementById('clearEventFormBtn').addEventListener('click', resetEventForm);
    document.getElementById('cancelEventEditBtn').addEventListener('click', closeEventForm);

    document.getElementById('eventForm').addEventListener('submit', async event => {
        event.preventDefault();

        try {
            const payload = getEventFormPayload();

            if (editingEventId) {
                await updateEventObj(editingEventId, payload);
            } else {
                await createEvent(payload);
            }

            await Promise.all([loadEvents(), loadRegistrations()]);
            closeEventForm();
            renderAll();
            showSection('events');
        } catch (error) {
            alert(error.message || 'Unable to save the event right now.');
        }
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    const user = await requireAuthPage(['organizer'], 'login.html');
    if (!user) return;

    currentUser = user;
    setupNavigation();
    setupToolbarBindings();
    setupEventActions();
    setupParticipantActions();
    setupFormActions();
    showSection('home');

    const welcome = document.getElementById('welcomeMsg');
    if (welcome) welcome.textContent = `Welcome, ${user.fullname || user.username}`;
    const sidebarUser = document.getElementById('sidebarUser');
    if (sidebarUser) sidebarUser.textContent = `${user.fullname || user.username}`;

    await Promise.all([loadEvents(), loadUsers(), loadRegistrations()]);
    renderAll();
    resetEventForm();

    document.getElementById('logoutLink').addEventListener('click', event => {
        event.preventDefault();
        logoutAndRedirect('login.html');
    });

    const themeBtn = document.getElementById('themeToggle');
    function applyTheme(theme) {
        if (theme === 'dark') document.body.classList.add('dark');
        else document.body.classList.remove('dark');
        if (themeBtn) themeBtn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        localStorage.setItem('theme', theme);
    }

    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const nextTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
            applyTheme(nextTheme);
        });
    }
});
