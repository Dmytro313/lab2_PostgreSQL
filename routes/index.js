const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, (req, res) => {
    res.render("index", { 
        username: req.session.username,
        queryString: "" 
    });
});

module.exports = router;