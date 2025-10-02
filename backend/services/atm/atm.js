const express = require("express");
const atmService = require("../atm"); // usa services/atm/index.js
const router = express.Router();

router.post("/cotizar", async (req, res) => {
  const svc = atmService();
  const result = await svc.cotizar(req.body);
  if (result.ok) return res.status(200).json(result.data);
  return res.status(result.status || 500).json({ error: result.error });
});

module.exports = router;
