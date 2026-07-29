const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Lista com os nomes dos modelos
const modelos = [
  'obra',
  'exemplar',
  'autor',
  'editora',
  'genero',
  'idioma',
  'localizacao',
  'imagem',
  'usuario'
];

// Mapeamento de inclusão automática de relacionamentos
const includes = {
  obra: { 
    autores: true, 
    generos: true, 
    capa: true, 
    exemplares: {
      include: {
        editora: true,
        idioma: true,
        localizacao: true,
        imagens: true
      }
    } 
  },
  exemplar: { obra: true, editora: true, idioma: true, localizacao: true, imagens: true }
};

// ==========================================
// 1. ROTAS CUSTOMIZADAS (Fora do Loop CRUD)
// ==========================================

// Rota para cadastrar livro/exemplar via ISBN
router.post('/exemplares/isbn/:isbn', async (req, res) => {
  const cleanIsbn = req.params.isbn.replace(/[^0-9X]/gi, '');
  const { obraId } = req.body; // 👈 Pega o ID da obra atual se enviado pelo Flutter

  try {
    let titulo, subtitulo, sinopse, paginas, anoEdicao, nomeAutor, nomeEditora;
    let urlCapa = null;

    // ... (Busca nas APIs Google Books / BrasilAPI / Open Library igual ao seu código) ...

    // --- CADASTRO NO PRISMA ---
    let targetObraId = obraId ? Number(obraId) : null;

    // Se NÃO passou um obraId, cria uma nova Obra
    if (!targetObraId) {
      let autor = null;
      if (nomeAutor) {
        let existente = await prisma.autor.findFirst({ where: { nome: nomeAutor } });
        autor = existente || await prisma.autor.create({ data: { nome: nomeAutor } });
      }

      const novaObra = await prisma.obra.create({
        data: {
          titulo,
          subtitulo,
          sinopse,
          autores: autor ? { connect: [{ id: autor.id }] } : undefined
        }
      });
      targetObraId = novaObra.id;
    }

    let editora = null;
    if (nomeEditora) {
      let existente = await prisma.editora.findFirst({ where: { nome: nomeEditora } });
      editora = existente || await prisma.editora.create({ data: { nome: nomeEditora } });
    }

    // Cria o Exemplar VINCULADO à Obra correta (targetObraId)
    const exemplar = await prisma.exemplar.create({
      data: {
        obraId: targetObraId,
        editoraId: editora ? editora.id : null,
        isbn: cleanIsbn,
        paginas: paginas,
        anoEdicao: anoEdicao,
        imagens: urlCapa 
          ? { create: [{ url: urlCapa, descricao: 'Capa do Exemplar' }] } 
          : undefined
      },
      include: {
        imagens: true,
        localizacao: true,
        idioma: true
      }
    });

    res.status(201).json({
      mensagem: 'Exemplar cadastrado com sucesso!',
      exemplar
    });

  } catch (err) {
    console.error('❌ Erro interno:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota dedicada para atualização de Exemplares com Relações
router.put('/exemplares/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { paginas, anoEdicao, localizacao, idioma, isbn } = req.body;

  try {
    let localizacaoConnect = undefined;
    if (localizacao) {
      let locExistente = await prisma.localizacao.findFirst({
        where: { descricao: localizacao }
      });
      if (!locExistente) {
        locExistente = await prisma.localizacao.create({
          data: { descricao: localizacao }
        });
      }
      localizacaoConnect = { connect: { id: locExistente.id } };
    }

    let idiomaConnect = undefined;
    if (idioma) {
      let idmExistente = await prisma.idioma.findFirst({
        where: { nome: idioma }
      });
      if (!idmExistente) {
        idmExistente = await prisma.idioma.create({
          data: { nome: idioma }
        });
      }
      idiomaConnect = { connect: { id: idmExistente.id } };
    }

    const exemplarAtualizado = await prisma.exemplar.update({
      where: { id: id },
      data: {
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        isbn: isbn || undefined,
        localizacao: localizacaoConnect,
        idioma: idiomaConnect
      },
      include: {
        localizacao: true,
        idioma: true,
        editora: true
      }
    });

    res.json(exemplarAtualizado);
  } catch (err) {
    console.error('Erro ao atualizar exemplar:', err);
    res.status(500).json({ erro: err.message });
  }
});

// ==========================================
// 2. FUNÇÃO E GERADOR DE ROTAS GENÉRICAS (CRUD)
// ==========================================

function criarRotasCrud(entidade) {
  // GET ALL
  router.get(`/${entidade}s`, async (req, res) => {
    try {
      const itens = await prisma[entidade].findMany({
        include: includes[entidade] || undefined
      });
      res.json(itens);
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  });

  // GET BY ID
  router.get(`/${entidade}s/:id`, async (req, res) => {
    try {
      const item = await prisma[entidade].findUnique({
        where: { id: Number(req.params.id) },
        include: includes[entidade] || undefined
      });
      if (!item) return res.status(404).json({ mensagem: 'Registro não encontrado' });
      res.json(item);
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  });

  // POST
  router.post(`/${entidade}s`, async (req, res) => {
    try {
      const novoItem = await prisma[entidade].create({
        data: req.body
      });
      res.status(201).json(novoItem);
    } catch (err) {
      res.status(400).json({ erro: err.message });
    }
  });

  // DELETE
  router.delete(`/${entidade}s/:id`, async (req, res) => {
    try {
      await prisma[entidade].delete({
        where: { id: Number(req.params.id) }
      });
      res.json({ mensagem: 'Registro removido com sucesso' });
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  });
}

// Registra as rotas genéricas CRUD para cada modelo
modelos.forEach(entidade => {
  criarRotasCrud(entidade);
});

module.exports = router;