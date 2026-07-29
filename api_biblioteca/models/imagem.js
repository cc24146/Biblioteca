const mongoose = require('mongoose');

const ImagemSchema = new mongoose.Schema({
  url: { type: String, required: true },
  descricao: String
}, { timestamps: true });

module.exports = mongoose.model('Imagem', ImagemSchema);