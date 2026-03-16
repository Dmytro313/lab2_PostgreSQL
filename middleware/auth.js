function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect("/auth/login");
}

module.exports = { requireAuth };