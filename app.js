const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require('path');
const fs = require('fs');
const pool = require("./db");
require("dotenv").config();

// 1. ПІДКЛЮЧЕННЯ РОУТЕРІВ 
const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");
const notesRouter = require("./routes/notes");
const profileRoutes = require('./routes/profile');

const app = express();

const helmet = require("helmet");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Дозволяємо наші стилі
            imgSrc: ["'self'", "data:", "https://via.placeholder.com", "blob:"], // Дозволяємо аватарки
            scriptSrc: ["'self'", "'unsafe-inline'"]
        },
    },
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 2. MIDDLEWARE
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 3. СЕСІЇ
app.use(session({
    store: new pgSession({ pool: pool }),
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
}));

// 4. ГЛОБАЛЬНІ ЗМІННІ ДЛЯ ШАБЛОНІВ
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const userRes = await pool.query("SELECT username, avatar FROM users WHERE id = $1", [req.session.userId]);
            res.locals.user = userRes.rows[0];
        } catch (err) {
            console.error(err);
        }
    }
    next();
});

// 5. РЕЄСТРАЦІЯ МАРШРУТІВ
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/notes', notesRouter);
app.use('/profile', profileRoutes);

// Автоматичне створення папок
const avatarsDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер працює на http://localhost:${PORT}`));