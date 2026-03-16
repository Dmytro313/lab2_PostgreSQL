const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");
require("dotenv").config();

const indexRouter = require("./routes/index");
const authRouter = require("./routes/auth");

const app = express();

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({
    pool: pool,
    createTableIfMissing: true, 
  }),
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(function (req, res, next) {
  res.locals.sessionUser = req.session.username || null;
  next();
});

app.use("/", indexRouter);
app.use("/auth", authRouter);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Сервер працює: http://localhost:${PORT}`);
});