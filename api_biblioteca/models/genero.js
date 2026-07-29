const mongoose = require('mongoose');

const GeneroSchema = new mongoose.Schema({
  nome: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Genero', GeneroSchema);