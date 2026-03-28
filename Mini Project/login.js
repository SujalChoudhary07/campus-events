document.querySelector("form").addEventListener("submit", async function(e){
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const role = document.getElementById('role') ? document.getElementById('role').value : 'participant';
    try {
        const resp = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username, password, role })
        });
        if (!resp.ok) throw new Error(await resp.text());
        const user = await resp.json();
        alert('Login Successful!');
        setAuthenticatedUser(user);
        if (user.role === 'organizer') location.href = 'organizer.html';
        else if (user.role === 'volunteer') location.href = 'volunteer.html';
        else location.href = 'dashboard.html';
    } catch (err) {
        alert('Unable to login: ' + err.message);
    }
});
