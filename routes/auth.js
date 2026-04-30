const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const pool = require("../db");

// Rate limiting для входу: 10 спроб за 15 хвилин
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 10, // максимум 10 запитів
  message: "Забагато спроб входу. Спробуйте через 15 хвилин.",
  standardHeaders: true, // Повертаємо інформацію про rate limit в `RateLimit-*` headers
  legacyHeaders: false, // Відключаємо `X-RateLimit-*` headers
});

// Сторінка реєстрації
router.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("register", { error: null });
});

// Обробка реєстрації
router.post("/register", async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password || !confirmPassword) {
    return res.render("register", { error: "Всі поля обов'язкові" });
  }
  if (password !== confirmPassword) {
    return res.render("register", { error: "Паролі не співпадають" });
  }

  try {
    const userExists = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (userExists.rows.length > 0) {
      return res.render("register", { error: "Користувач вже існує" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username",
      [username, email, hashedPassword]
    );

    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].username;
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.render("register", { error: "Помилка сервера" });
  }
});

// Сторінка входу
router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/");
  res.render("login", { error: null });
});

// Обробка входу
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user) return res.render("login", { error: "Невірний email або пароль" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.render("login", { error: "Невірний email або пароль" });

    req.session.userId = user.id;
    req.session.username = user.username;

    // Якщо користувач вибрав "Запам'ятати мене", встановлюємо дольший термін сесії
    if (rememberMe === 'on') {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 днів
    } else {
      req.session.cookie.expires = false; // Сесія буде знищена при закритті браузера
    }

    req.session.save(() => {
      res.redirect("/");
    });
  } catch (err) {
    console.error(err);
    res.render("login", { error: "Помилка сервера" });
  }
});

// Вихід
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/auth/login"));
});

module.exports = router;