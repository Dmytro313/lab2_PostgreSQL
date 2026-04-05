const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { Parser } = require("json2csv");

// Захищаємо всі маршрути в цьому файлі одним рядком
router.use(requireAuth);

// ДОПОМІЖНА ФУНКЦІЯ ДЛЯ ФІЛЬТРІВ

function buildQuery(reqQuery, userId, isExport = false) {
    let { search, period, sort, page, limit } = reqQuery;

    // Нормалізація параметрів
    page = Math.max(1, parseInt(page) || 1);
    limit = [5, 10, 20, 50].includes(parseInt(limit)) ? parseInt(limit) : 10;
    sort = sort === "oldest" ? "ASC" : "DESC"; // newest = DESC, oldest = ASC
    period = ["7d", "30d", "all"].includes(period) ? period : "all";
    search = search ? search.trim() : "";

    const offset = (page - 1) * limit;

    // Ізоляція даних користувача
    let whereClauses = ["user_id = $1"];
    let params = [userId];

    // Пошук
    if (search) {
        params.push(`%${search}%`);
        whereClauses.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
    }

    // Період
    if (period === "7d") {
        whereClauses.push(`created_at >= NOW() - INTERVAL '7 days'`);
    } else if (period === "30d") {
        whereClauses.push(`created_at >= NOW() - INTERVAL '30 days'`);
    }

    const whereString = "WHERE " + whereClauses.join(" AND ");

    if (isExport) {
        return {
            sql: `SELECT title, content, created_at FROM notes ${whereString} ORDER BY created_at ${sort}`,
            params
        };
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    return {
        dataSql: `SELECT * FROM notes ${whereString} ORDER BY created_at ${sort} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        countSql: `SELECT COUNT(*) FROM notes ${whereString}`,
        paramsForData: params,
        paramsForCount: params.slice(0, params.length - 2),
        filters: { search, period, sort: sort === "ASC" ? "oldest" : "newest", page, limit }
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


// CRUD

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
    res.redirect("/notes"); 
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
      [req.params.id, req.session.userId] 
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