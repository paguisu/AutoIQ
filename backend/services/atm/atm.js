const express = require("express");
const atmService = require("../services/atm");
const router = express.Router();

router.post("/cotizar", async (req, res) => {
  const svc = atmService();
  const result = await svc.cotizar(req.body);
  if (result.ok) return res.status(200).json(result.data);
  return res.status(result.status || 500).json({ error: result.error });
});

module.exports = router;
