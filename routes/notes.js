const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

// Захищаємо ВСІ маршрути в цьому файлі одним рядком
// Якщо користувач не залогінений, його перекине на сторінку входу
router.use(requireAuth);

// 1. GET /notes — Список нотаток поточного користувача
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM notes WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.userId]
    );
    res.render("notes/index", { notes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка сервера");
  }
});

// 2. GET /notes/new — Форма створення нової нотатки
router.get("/new", (req, res) => {
  res.render("notes/new");
});

// 3. POST /notes — Зберегти нову нотатку в базу
router.post("/", async (req, res) => {
  const { title, content } = req.body;
  try {
    await pool.query(
      "INSERT INTO notes (user_id, title, content) VALUES ($1, $2, $3)",
      [req.session.userId, title, content]
    );
    res.redirect("/notes"); // Після створення кидаємо назад до списку
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка при збереженні");
  }
});

// 4. GET /notes/:id/edit — Форма редагування існуючої нотатки
router.get("/:id/edit", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM notes WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId] // Перевіряємо, чи це нотатка саме цього юзера!
    );
    
    if (result.rows.length === 0) return res.status(404).send("Нотатку не знайдено або у вас немає доступу");
    
    res.render("notes/edit", { note: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка сервера");
  }
});

// 5. POST /notes/:id — Зберегти зміни після редагування
router.post("/:id", async (req, res) => {
  const { title, content } = req.body;
  try {
    await pool.query(
      "UPDATE notes SET title = $1, content = $2 WHERE id = $3 AND user_id = $4",
      [title, content, req.params.id, req.session.userId]
    );
    res.redirect("/notes");
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка при оновленні");
  }
});

// 6. POST /notes/:id/delete — Видалити нотатку
router.post("/:id/delete", async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM notes WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    res.redirect("/notes");
  } catch (err) {
    console.error(err);
    res.status(500).send("Помилка при видаленні");
  }
});

module.exports = router;