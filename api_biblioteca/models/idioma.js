const mongoose = require('mongoose');

const IdiomaSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  sigla: String // Ex: PT, EN, ES
}, { timestamps: true });

module.exports = mongoose.model('Idioma', IdiomaSchema);