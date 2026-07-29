const mongoose = require('mongoose');

// Representa a cópia física que você possui no seu armário/estante
const ExemplarSchema = new mongoose.Schema({
  obra: { type: mongoose.Schema.Types.ObjectId, ref: 'Obra', required: true },
  editora: { type: mongoose.Schema.Types.ObjectId, ref: 'Editora' },
  idioma: { type: mongoose.Schema.Types.ObjectId, ref: 'Idioma' },
  localizacao: { type: mongoose.Schema.Types.ObjectId, ref: 'Localizacao' },
  proprietario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  imagens: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Imagem' }],
  anoEdicao: Number,
  isbn: String,
  paginas: Number
}, { timestamps: true });

module.exports = mongoose.model('Exemplar', ExemplarSchema);