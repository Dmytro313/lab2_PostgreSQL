const { Pool } = require("pg");
require("dotenv").config(); // Підключаємо змінні з .env

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "myapp",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
});

module.exports = pool;