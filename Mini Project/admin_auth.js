// Admin auth helper for login and register pages
document.addEventListener('DOMContentLoaded', ()=>{
    const loginForm = document.getElementById('adminLoginForm');
    const regForm = document.getElementById('adminRegisterForm');

    async function api(path, opts={}){
        const res = await fetch('/api'+path, opts);
        if(!res.ok) throw new Error(await res.text());
        return res.json();
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e)=>{
            e.preventDefault();
            const username = document.getElementById('adminUsername').value.trim();
            const password = document.getElementById('adminPassword').value;
            try{
                const user = await api('/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password, role:'admin' }) });
                setAuthenticatedUser(user);
                location.href = 'admin.html';
            }catch(err){
                alert('Login failed: '+err.message);
            }
        });
    }

    if (regForm) {
        regForm.addEventListener('submit', async (e)=>{
            e.preventDefault();
            const fullname = document.getElementById('adminFullname').value.trim();
            const username = document.getElementById('adminUsernameReg').value.trim();
            const email = document.getElementById('adminEmailReg').value.trim();
            const phone = document.getElementById('adminPhoneReg').value.trim();
            const password = document.getElementById('adminPasswordReg').value;
            const confirmPassword = document.getElementById('adminConfirmPasswordReg').value;
            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }
            try{
                const user = await api('/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ fullname, username, email, phone, password, role:'admin' }) });
                // automatically login
                setAuthenticatedUser(user);
                location.href = 'admin.html';
            }catch(err){
                alert('Registration failed: '+err.message);
            }
        });
    }
});
