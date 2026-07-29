const express = require('express');
const cors = require('cors');
require('dotenv').config();

const apiRoutes = require('./routes/apiRoutes'); // <--- Importou o arquivo de rotas

const app = express();

app.use(cors());
app.use(express.json()); // <--- Necessário para ler o Body em JSON

// Monta o prefixo /api
app.use('/api', apiRoutes); // <--- As rotas viram /api/autors, /api/obras, etc.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});