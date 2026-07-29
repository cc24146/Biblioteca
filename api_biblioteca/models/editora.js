const mongoose = require('mongoose');

const EditoraSchema = new mongoose.Schema({
  nome: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Editora', EditoraSchema);