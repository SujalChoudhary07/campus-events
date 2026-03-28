function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem('user') || 'null');
    } catch (error) {
        return null;
    }
}

function getAuthToken() {
    const user = getStoredUser();
    return user && user.authToken ? user.authToken : '';
}

function getAuthHeaders(extraHeaders = {}) {
    const token = getAuthToken();
    return {
        ...extraHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

async function apiFetch(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: getAuthHeaders(options.headers || {})
    });

    if (response.status === 401) {
        clearAuth();
    }

    return response;
}

function setAuthenticatedUser(user) {
    if (!user) return;
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('currentUser', user.username || '');
}

function clearAuth() {
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
}

async function logoutAndRedirect(target = 'login.html') {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch (error) {
        // Ignore logout transport errors and clear local session anyway.
    } finally {
        clearAuth();
        window.location.href = target;
    }
}

async function requireAuthPage(expectedRoles, redirectTo) {
    const user = getStoredUser();
    const roles = Array.isArray(expectedRoles) ? expectedRoles : [expectedRoles];

    if (!user || !user.authToken) {
        clearAuth();
        window.location.href = redirectTo;
        return null;
    }

    try {
        const response = await apiFetch('/api/session');
        if (!response.ok) {
            throw new Error(await response.text());
        }

        const verifiedUser = await response.json();
        const mergedUser = { ...user, ...verifiedUser, authToken: user.authToken };
        setAuthenticatedUser(mergedUser);

        if (roles[0] && !roles.includes(mergedUser.role)) {
            clearAuth();
            window.location.href = redirectTo;
            return null;
        }

        return mergedUser;
    } catch (error) {
        clearAuth();
        window.location.href = redirectTo;
        return null;
    }
}
