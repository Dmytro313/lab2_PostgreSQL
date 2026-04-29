const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { Parser } = require("json2csv");

// Захищаємо всі маршрути в цьому файлі одним рядком
router.use(requireAuth);

// ДОПОМІЖНА ФУНКЦІЯ ДЛЯ ФІЛЬТРІВ

function buildQuery(reqQuery, userId, isExport = false) {
    let { search, period, sort, page, limit, tag } = reqQuery;
    
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;
    
    let whereConditions = ["user_id = $1"];
    let params = [userId];
    let paramIndex = 2; // Наступний вільний номер параметра (буде $2)

    // 1. Фільтр пошуку
    if (search) {
        whereConditions.push(`(title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`);
        params.push(`%${search}%`);
        paramIndex++;
    }

    // 2. Фільтр періоду
    if (period === '7d') {
        whereConditions.push(`created_at >= NOW() - INTERVAL '7 days'`);
    } else if (period === '30d') {
        whereConditions.push(`created_at >= NOW() - INTERVAL '30 days'`);
    }

    // 3. Фільтр за тегом
    if (tag) {
        // Замість ::text використовуємо залізобетонний CAST(... AS VARCHAR)
        whereConditions.push(`
            EXISTS (
                SELECT 1 FROM note_tags nt 
                JOIN tags t ON nt.tag_id = t.id 
                WHERE nt.note_id = notes.id AND t.name = CAST($${paramIndex} AS VARCHAR)
            )
        `);
        params.push(tag);
        paramIndex++;
    }

    // 4. ЗБИРАЄМО РЯДКИ (Тільки після того, як всі умови додані!)
    const whereString = "WHERE " + whereConditions.join(" AND ");
    
    // Тепер countSql точно містить всі потрібні знаки долара ($1, $2 і т.д.)
    const countSql = `SELECT COUNT(*) FROM notes ${whereString}`;

    // Збираємо основний запит
    const dataSql = `
        SELECT notes.*, 
        (SELECT string_agg(tags.name, ', ') 
         FROM tags 
         JOIN note_tags ON tags.id = note_tags.tag_id 
         WHERE note_tags.note_id = notes.id) as tags_list
        FROM notes 
        ${whereString} 
        ORDER BY created_at ${sort === 'oldest' ? 'ASC' : 'DESC'} 
        ${isExport ? '' : `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`}
    `;

    // Формуємо параметри для dataSql (додаємо ліміт та відступ в кінець)
    let paramsForData = [...params];
    if (!isExport) {
        paramsForData.push(limit, offset);
    }

    return {
        dataSql,
        countSql,
        paramsForData,
        paramsForCount: params,
        filters: { 
            search: search || '', 
            period: period || 'all', 
            sort: sort || 'newest', 
            page, 
            limit, 
            tag: tag || '' 
        }
    };
}


// 1. GET /notes — Список нотаток

router.get("/", async (req, res) => {
    try {
        const { dataSql, countSql, paramsForData, paramsForCount, filters } = buildQuery(req.query, req.session.userId);

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataSql, paramsForData),
            pool.query(countSql, paramsForCount)
        ]);

        const totalNotes = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalNotes / filters.limit) || 1;

        const queryParams = new URLSearchParams(req.query);
        queryParams.delete('page'); 
        const queryString = queryParams.toString();

        res.render("notes/index", {
            notes: dataResult.rows,
            filters,
            totalPages,
            currentPage: filters.page,
            queryString: queryString ? `&${queryString}` : '' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка сервера");
    }
});


// 1.5. GET /notes/export.csv — Експорт

router.get("/export.csv", async (req, res) => {
    try {
        const { sql, params } = buildQuery(req.query, req.session.userId, true);
        const result = await pool.query(sql, params);

        const fields = ['title', 'content', 'created_at'];
        const json2csvParser = new Parser({ fields });
        const csvData = json2csvParser.parse(result.rows);

        res.header('Content-Type', 'text/csv');
        res.attachment('notes_export.csv');
        return res.send(csvData);
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка експорту");
    }
});



//GET /note/stats - Сторінка статистики

router.get("/stats", async (req, res) => {
    const userId = req.session.userId;

    try {
        // Ми використовуємо Promise.all, щоб виконати всі ці важкі запити ОДНОЧАСНО, а не по черзі.
        // Це робить завантаження сторінки блискавичним.
        const [
            totalNotesRes,
            recentNotesRes,
            noTagsRes,
            topTagsRes,
            avgLengthRes,
            longestTitleRes
        ] = await Promise.all([
            // 1. Загальна кількість
            pool.query("SELECT COUNT(*) FROM notes WHERE user_id = $1", [userId]),
            
            // 2. За 7 та 30 днів (рахуємо в одному запиті за допомогою FILTER)
            pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as days_7,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as days_30
                FROM notes WHERE user_id = $1
            `, [userId]),
            
            // 3. Без тегів (шукаємо нотатки, яких немає в таблиці note_tags)
            pool.query(`
                SELECT COUNT(*) 
                FROM notes n
                LEFT JOIN note_tags nt ON n.id = nt.note_id
                WHERE n.user_id = $1 AND nt.tag_id IS NULL
            `, [userId]),

            // 4. Топ-5 тегів (Групуємо по імені тега, рахуємо кількість з'єднань)
            pool.query(`
                SELECT t.name, COUNT(nt.note_id) as uses_count
                FROM tags t
                JOIN note_tags nt ON t.id = nt.tag_id
                WHERE t.user_id = $1
                GROUP BY t.name
                ORDER BY uses_count DESC
                LIMIT 5
            `, [userId]),

            // 5. Середня довжина тіла нотатки
            pool.query("SELECT ROUND(AVG(LENGTH(content))) as avg_length FROM notes WHERE user_id = $1", [userId]),

            // 6. Найдовший заголовок
            pool.query("SELECT title, LENGTH(title) as len FROM notes WHERE user_id = $1 ORDER BY len DESC LIMIT 1", [userId])
        ]);

        // Передаємо всі зібрані дані в шаблон
        res.render("notes/stats", {
            total: totalNotesRes.rows[0].count,
            days7: recentNotesRes.rows[0].days_7 || 0,
            days30: recentNotesRes.rows[0].days_30 || 0,
            noTags: noTagsRes.rows[0].count,
            topTags: topTagsRes.rows,
            avgLength: avgLengthRes.rows[0].avg_length || 0,
            longestTitle: longestTitleRes.rows[0]?.title || "Немає нотаток"
        });

    } catch (err) {
        console.error("Помилка статистики:", err);
        res.status(500).send("Не вдалося завантажити статистику");
    }
});

router.get("/new", (req, res) => {
    res.render("notes/new");
});

// 2. POST /notes — Створити нову нотатку (ОНОВЛЕНО: додано теги)
router.post("/", async (req, res) => {
    const { title, content, tags_string } = req.body;
    const userId = req.session.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Починаємо транзакцію

        // 1. Створюємо саму нотатку
        const noteResult = await client.query(
            "INSERT INTO notes (user_id, title, content) VALUES ($1, $2, $3) RETURNING id",
            [userId, title, content]
        );
        const noteId = noteResult.rows[0].id;

        // 2. Якщо є теги — обробляємо їх
        if (tags_string) {
            const tagNames = tags_string.split(',')
                .map(tag => tag.trim())
                .filter(tag => tag !== "");

            for (const tagName of tagNames) {
                // Шукаємо, чи існує вже такий тег у цього користувача
                let tagResult = await client.query(
                    "SELECT id FROM tags WHERE name = $1 AND user_id = $2",
                    [tagName, userId]
                );

                let tagId;
                if (tagResult.rows.length === 0) {
                    // Якщо немає — створюємо новий
                    const newTagResult = await client.query(
                        "INSERT INTO tags (user_id, name) VALUES ($1, $2) RETURNING id",
                        [userId, tagName]
                    );
                    tagId = newTagResult.rows[0].id;
                } else {
                    tagId = tagResult.rows[0].id;
                }

                // Створюємо зв'язок у таблиці-мосту
                await client.query(
                    "INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2)",
                    [noteId, tagId]
                );
            }
        }

        await client.query('COMMIT'); // Фіксуємо зміни
        res.redirect("/notes");
    } catch (err) {
        await client.query('ROLLBACK'); // Якщо помилка — скасовуємо все
        console.error(err);
        res.status(500).send("Помилка при створенні нотатки");
    } finally {
        client.release();
    }
});

// 4. GET /notes/:id/edit — Форма редагування 
router.get("/:id/edit", async (req, res) => {
    try {
        // Завантажуємо нотатку
        const noteResult = await pool.query(
            "SELECT * FROM notes WHERE id = $1 AND user_id = $2",
            [req.params.id, req.session.userId]
        );

        if (noteResult.rows.length === 0) return res.status(404).send("Нотатку не знайдено");

        // Завантажуємо теги для цієї нотатки
        const tagsResult = await pool.query(`
            SELECT t.name 
            FROM tags t
            JOIN note_tags nt ON t.id = nt.tag_id
            WHERE nt.note_id = $1
        `, [req.params.id]);

        // Перетворюємо масив об'єктів у рядок через кому: ["work", "idea"] -> "work, idea"
        const tagsString = tagsResult.rows.map(t => t.name).join(", ");

        res.render("notes/edit", { 
            note: noteResult.rows[0],
            tags_string: tagsString 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Помилка сервера");
    }
});

// 5. POST /notes/:id — Зберегти зміни
router.post("/:id", async (req, res) => {
    const { title, content, tags_string } = req.body;
    const noteId = req.params.id;
    const userId = req.session.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Оновлюємо саму нотатку
        await client.query(
            "UPDATE notes SET title = $1, content = $2 WHERE id = $3 AND user_id = $4",
            [title, content, noteId, userId]
        );

        // 2. Видаляємо всі старі зв'язки з тегами для цієї нотатки
        await client.query("DELETE FROM note_tags WHERE note_id = $1", [noteId]);

        // 3. Додаємо нові теги (якщо вони є)
        if (tags_string) {
            const tagNames = tags_string.split(',').map(tag => tag.trim()).filter(tag => tag !== "");

            for (const tagName of tagNames) {
                // Перевіряємо чи існує тег
                let tagResult = await client.query(
                    "SELECT id FROM tags WHERE name = $1 AND user_id = $2",
                    [tagName, userId]
                );

                let tagId;
                if (tagResult.rows.length === 0) {
                    const newTagResult = await client.query(
                        "INSERT INTO tags (user_id, name) VALUES ($1, $2) RETURNING id",
                        [userId, tagName]
                    );
                    tagId = newTagResult.rows[0].id;
                } else {
                    tagId = tagResult.rows[0].id;
                }

                // Створюємо новий зв'язок
                await client.query(
                    "INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2)",
                    [noteId, tagId]
                );
            }
        }

        await client.query('COMMIT');
        res.redirect("/notes");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send("Помилка при оновленні");
    } finally {
        client.release();
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