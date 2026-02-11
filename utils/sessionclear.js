// utils/session.js
async function clearOrderSession(req, keep = {}) {
  // preserve small prefs if needed (e.g. lang)
  const { lang = req.session?.lang } = keep;

  // either regenerate (fresh session id) or just reset fields:
  await new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });

  // set back tiny prefs and wipe order state
  req.session.lang = lang;
  req.session.cart = [];
  req.session.favorites = [];

  await new Promise(resolve => req.session.save(resolve));
}

module.exports = { clearOrderSession };
