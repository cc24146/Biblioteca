const mongoose = require('mongoose');

// Define onde o livro está guardado (ex: Estante Sala, Prateleira 2)
const LocalizacaoSchema = new mongoose.Schema({
  descricao: { type: String, required: true },
  detalhes: String
}, { timestamps: true });

module.exports = mongoose.model('Localizacao', LocalizacaoSchema);