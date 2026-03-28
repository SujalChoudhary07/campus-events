# Mini Project Event Management

This workspace contains a static frontend built with HTML/CSS/JavaScript and a simple Node.js backend using Express and LowDB for data storage.

## Running the application

1. **Install dependencies**

   ```bash
   cd "c:\Users\hp\Documents\Mini Project"
   npm install
   ```

2. **Start the server**

   ```bash
   npm run start
   ```

   or during development use `npm run dev` if you have `nodemon` installed.

3. **Access the site**

   Open your browser to `http://localhost:3000/index.html` (or simply `http://localhost:3000/`).

   The server serves static files from the `Mini Project` folder and exposes a REST API under `/api`.

## API endpoints

- `POST /api/register` - register a new user (body: `{fullname,username,password,role}`)
- `POST /api/login` - login existing user (body: `{username,password}`)
- `GET /api/events` - list events
- `POST /api/events` - create event
- `PUT /api/events/:id` - update event
- `DELETE /api/events/:id` - delete event
- `GET /api/registrations` - list all registrations
- `GET /api/registrations/:username` - registrations for a user
- `POST /api/registrations` - create registration
- `GET /api/tickets` - list support tickets
- `POST /api/tickets` - submit ticket
- `GET /api/profile/:username` - fetch profile
- `PUT /api/profile/:username` - update profile

## Notes

- Data is stored in `db.json` at the project root. It is simple JSON; you can inspect or delete it to reset state.
- User passwords are now required and stored hashed. Responses from the API omit the password field for security.

Feel free to expand the API, add validation, or swap LowDB for a proper database.
