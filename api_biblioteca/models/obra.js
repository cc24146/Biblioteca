const mongoose = require('mongoose');

const ObraSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  subtitulo: String,
  autores: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Autor' }],
  generos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Genero' }],
  sinopse: String,
  capa: { type: mongoose.Schema.Types.ObjectId, ref: 'Imagem' }
}, { timestamps: true });

module.exports = mongoose.model('Obra', ObraSchema);