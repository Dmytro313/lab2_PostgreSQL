const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcryptjs");
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
router.post("/avatar", (req, res, next) => {
    // Обгортка для перехоплення помилок multer
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

// POST /profile/password — Зміна пароля
router.post("/password", async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.userId;

    try {
        // 1. Базова валідація
        if (!currentPassword || !newPassword || !confirmPassword) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Всі поля обов'язкові",
                passwordError: true 
            });
        }

        // 2. Перевірка співпадіння паролів
        if (newPassword !== confirmPassword) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Новий пароль і підтвердження не співпадають",
                passwordError: true 
            });
        }

        // 3. Перевірка мінімальної довжини пароля
        if (newPassword.length < 8) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Новий пароль повинен мати мінімум 8 символів",
                passwordError: true 
            });
        }

        // 4. Завантажуємо хеш пароля з БД
        const result = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
        const storedHash = result.rows[0].password;

        // 5. Порівнюємо поточний пароль з хешем
        const isMatch = await bcrypt.compare(currentPassword, storedHash);
        if (!isMatch) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Поточний пароль невірний",
                passwordError: true 
            });
        }

        // 6. Захешуємо новий пароль
        const newHash = await bcrypt.hash(newPassword, 12);

        // 7. Оновлюємо БД
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [newHash, userId]);

        const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
        res.render("profile", { 
            user: user.rows[0], 
            success: "Пароль успішно змінено!"
        });
    } catch (err) {
        console.error(err);
        const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
        res.render("profile", { 
            user: user.rows[0], 
            error: "Помилка при зміні пароля"
        });
    }
});

// POST /profile/info — Зміна username та email
router.post("/info", async (req, res) => {
    const { username, email } = req.body;
    const userId = req.session.userId;

    try {
        // 1. Валідація
        if (!username || !email) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Ім'я та email обов'язкові",
                infoError: true 
            });
        }

        // 2. Базова валідація email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Невірний формат email",
                infoError: true 
            });
        }

        // 3. Перевірка конфлікту з іншим користувачем
        const conflict = await pool.query(
            "SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3",
            [username, email, userId]
        );

        if (conflict.rows.length > 0) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Це ім'я або email вже зайняті",
                infoError: true 
            });
        }

        // 4. Оновлюємо БД
        await pool.query(
            "UPDATE users SET username = $1, email = $2 WHERE id = $3",
            [username, email, userId]
        );

        // 5. Оновлюємо сесію
        req.session.username = username;

        const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
        res.render("profile", { 
            user: user.rows[0], 
            success: "Інформація профілю успішно оновлена!"
        });
    } catch (err) {
        console.error(err);
        const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
        res.render("profile", { 
            user: user.rows[0], 
            error: "Помилка при оновленні інформації"
        });
    }
});

// POST /profile/delete — Видалити акаунт
router.post("/delete", async (req, res) => {
    const { password } = req.body;
    const userId = req.session.userId;

    try {
        // 1. Валідація
        if (!password) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Пароль обов'язковий для видалення акаунту",
                deleteError: true 
            });
        }

        // 2. Завантажуємо хеш пароля та аватара
        const result = await pool.query(
            "SELECT password, avatar FROM users WHERE id = $1", 
            [userId]
        );
        const storedHash = result.rows[0].password;
        const avatar = result.rows[0].avatar;

        // 3. Порівнюємо пароль
        const isMatch = await bcrypt.compare(password, storedHash);
        if (!isMatch) {
            const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
            return res.render("profile", { 
                user: user.rows[0], 
                error: "Пароль невірний. Видалення скасовано.",
                deleteError: true 
            });
        }

        // 4. Видаляємо аватар з диска
        if (avatar) {
            const fullPath = path.join(__dirname, "..", avatar);
            await fs.unlink(fullPath).catch(e => console.error("Файл вже видалено:", e));
        }

        // 5. Видаляємо користувача (каскад видалить нотатки, теги)
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);

        // 6. Знищуємо сесію
        req.session.destroy(() => {
            res.redirect("/");
        });
    } catch (err) {
        console.error(err);
        const user = await pool.query("SELECT username, email, avatar FROM users WHERE id = $1", [userId]);
        res.render("profile", { 
            user: user.rows[0], 
            error: "Помилка при видаленні акаунту"
        });
    }
});

module.exports = router;