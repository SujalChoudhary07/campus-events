document.querySelector("form").addEventListener("submit", async function(e){
    e.preventDefault();
    const fullname = document.getElementById('fullname').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const role = document.getElementById('role') ? document.getElementById('role').value : 'participant';
    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }
    try {
        const resp = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ fullname, email, phone, username, password, role })
        });
        if (!resp.ok) throw new Error(await resp.text());
        const user = await resp.json();
        alert('Registration Successful!');
        setAuthenticatedUser(user);
        if (user.role === 'organizer') location.href = 'organizer.html';
        else if (user.role === 'volunteer') location.href = 'volunteer.html';
        else location.href = 'dashboard.html';
    } catch(err) {
        alert('Unable to register: ' + err.message);
    }
});
