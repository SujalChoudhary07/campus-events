/*
  Volunteer dashboard script
*/

let events = [];
let assignedEvents = [];
let tasks = [
    { id: 1, eventId: 1, description: "Set up registration desk" },
    { id: 2, eventId: 1, description: "Guide participants to their seats" },
    { id: 3, eventId: 2, description: "Distribute snacks and drinks" }
];

// --- backend helpers -------------------------------------------------------
async function api(path, opts = {}) {
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
}

// UI
function renderAssignedEvents() {
    const container = document.getElementById('eventContainer');
    container.innerHTML = '';
    // For now, let's just show all events. In a real app, you'd filter by assignment.
    assignedEvents = events;
    assignedEvents.forEach(e => {
        const card = document.createElement('div');
        card.className = 'event-card reveal';
        card.innerHTML = `
            <h3>${e.title}</h3>
            <p>${e.desc}</p>
            <p>Date: ${e.date}</p>
        `;
        container.appendChild(card);
    });
}

function renderTasks() {
    const container = document.getElementById('taskList');
    container.innerHTML = '<table><thead><tr><th>Event</th><th>Task</th></tr></thead><tbody></tbody></table>';
    const tbody = container.querySelector('tbody');
    tasks.forEach(t => {
        const event = events.find(e => e.id === t.eventId);
        if (event) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${event.title}</td><td>${t.description}</td>`;
            tbody.appendChild(row);
        }
    });
}


// utility to switch visible section
function showSection(id) {
    document.querySelectorAll('.main-content .section').forEach(sec => {
        sec.classList.toggle('hidden', sec.id !== id);
    });
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.classList.toggle('active', link.dataset.section === id);
    });
    if (id === 'events') renderAssignedEvents();
    if (id === 'tasks') renderTasks();
}

function setupNavigation() {
    document.querySelectorAll('.sidebar ul li a').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            showSection(link.dataset.section);
        });
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    const user = await requireAuthPage(['volunteer'], 'login.html');
    if (!user) return;

    setupNavigation();
    showSection('home');

    if (user.username) {
        const welcome = document.getElementById('welcomeMsg');
        if (welcome) welcome.textContent = `Welcome, ${user.fullname || user.username}`;
        const sidebarUser = document.getElementById('sidebarUser');
        if (sidebarUser) sidebarUser.textContent = `${user.fullname || user.username}`;
    }

    await loadEvents();
    renderAssignedEvents();
    renderTasks();


    document.getElementById('logoutLink').addEventListener('click', () => {
        logoutAndRedirect('login.html');
    });

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
});
