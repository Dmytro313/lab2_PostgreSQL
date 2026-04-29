const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs/promises");
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { avatarUpload } = require("../middleware/upload");

router.use(requireAuth);

// GET /profile — Сторінка профілю
router.get("/", async (req, res) => {
    try {
        const result = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [req.session.userId]);
        const user = result.rows[0];
        
        res.render("profile", { user, error: null });
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка завантаження профілю");
    }
});

// POST /profile/avatar — Завантажити новий аватар
// Використовуємо upload.single('avatar'), де 'avatar' - це name інпуту у формі
router.post("/avatar", (req, res, next) => {
    // Обгортка для перехоплення помилок multer (наприклад, завеликий файл)
    avatarUpload.single('avatar')(req, res, (err) => {
        if (err) {
            return res.render("profile", { user: { username: req.session.username }, error: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.redirect("/profile");

    const userId = req.session.userId;
    const newAvatarPath = `/uploads/avatars/${req.file.filename}`;

    try {
        // Дізнаємось старий аватар
        const userRes = await pool.query("SELECT avatar FROM users WHERE id = $1", [userId]);
        const oldAvatar = userRes.rows[0].avatar;

        // Оновлюємо БД
        await pool.query("UPDATE users SET avatar = $1 WHERE id = $2", [newAvatarPath, userId]);

        // Якщо був старий аватар — видаляємо його фізично з диска
        if (oldAvatar) {
            const fullPath = path.join(__dirname, "..", oldAvatar);
            await fs.unlink(fullPath).catch(e => console.error("Не вдалося видалити старий файл:", e));
        }

        res.redirect("/profile");
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка збереження аватара");
    }
});

// POST /profile/avatar/delete — Видалити аватар
router.post("/avatar/delete", async (req, res) => {
    const userId = req.session.userId;

    try {
        const userRes = await pool.query("SELECT avatar FROM users WHERE id = $1", [userId]);
        const oldAvatar = userRes.rows[0].avatar;

        if (oldAvatar) {
            // Видаляємо з диска
            const fullPath = path.join(__dirname, "..", oldAvatar);
            await fs.unlink(fullPath).catch(e => console.error("Файл вже видалено:", e));
            
            // Обнуляємо в БД
            await pool.query("UPDATE users SET avatar = NULL WHERE id = $1", [userId]);
        }

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка видалення");
    }
});

module.exports = router;