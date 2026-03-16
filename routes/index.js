const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, function (req, res, next) {
  res.render("index", { title: "Головна", username: req.session.username });
});

module.exports = router;