const mongoose = require('mongoose');

const AutorSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  biografia: String
}, { timestamps: true });

module.exports = mongoose.model('Autor', AutorSchema);