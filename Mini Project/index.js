/* index.js - Dynamic events for the landing page */

let events = [];

async function api(path, opts = {}) {
    const res = await fetch('/api' + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function loadEvents() {
    try {
        events = await api('/events');
        renderIndexEvents();
    } catch (e) {
        console.error('loadEvents error', e);
        document.querySelector('.event-container').innerHTML = '<p class="table-empty">Loading events...</p>';
    }
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '<', '>': '>', '"': '"', "'": '&#39;'
    }[char]));
}

function renderIndexEvents() {
    const container = document.querySelector('.event-container');
    if (!container) {
        return;
    }

    const upcomingEvents = [...events]
        .filter(event => event.date && new Date(event.date) >= new Date(new Date().toDateString()))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 3);

    if (!upcomingEvents.length) {
        container.innerHTML = '<p class="table-empty">No upcoming events. <a href="register.html">Create account</a> to see more.</p>';
        return;
    }

    container.innerHTML = upcomingEvents.map(event => {
        const feeLabel = 'Free for all participants';
        
        return `
            <div class="event-card tilt reveal">
                <div class="event-card-top">
                    <span class="event-status-badge upcoming-badge">Free</span>
                </div>
                <h3>${escapeHtml(event.title)}</h3>
                <p>${escapeHtml(event.desc || 'Join this exciting campus event!')}</p>
                <p><strong>Entry:</strong> ${feeLabel}</p>
                ${event.date ? `<p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>` : ''}
                <div class="event-card-actions">
                    <button class="card-btn ripple join-btn" onclick="openDashboardForEvent(${event.id})">Register</button>
                    <a href="dashboard.html" class="card-btn ripple secondary-chat-btn">View in Dashboard</a>
                </div>
            </div>
        `;
    }).join('');

    if (typeof reveal === 'function') {
        reveal();
    }
}

function openDashboardForEvent(eventId) {
    // Open dashboard with event pre-selected (dashboard.js handles this)
    window.open(`dashboard.html#event=${eventId}`, '_blank');
}

window.addEventListener('DOMContentLoaded', () => {
    loadEvents();
});

