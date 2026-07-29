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

  try {
    let titulo, subtitulo, sinopse, paginas, anoEdicao, nomeAutor, nomeEditora;
    let urlCapa = null;

    console.log(`\n🔎 Pesquisando ISBN: ${cleanIsbn}...`);

    // 1. Tenta buscar no Google Books
    const googleResponse = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`,
      { headers: { 'User-Agent': 'BibliotecaApp/1.0' } }
    );

    console.log(`📡 Status Google Books: ${googleResponse.status}`);

    if (googleResponse.ok) {
      const data = await googleResponse.json();

      if (data.items && data.items.length > 0) {
        const info = data.items[0].volumeInfo;
        titulo = info.title || null;
        subtitulo = info.subtitle || null;
        sinopse = info.description || null;
        paginas = info.pageCount || null;
        anoEdicao = info.publishedDate ? parseInt(info.publishedDate.substring(0, 4)) : null;
        nomeAutor = info.authors ? info.authors[0] : null;
        nomeEditora = info.publisher || null;

        if (info.imageLinks) {
          urlCapa = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || null;
        }
      }
    } else {
      console.log('⚠️ Google Books falhou ou bloqueou a requisição.');
    }

    // 2. Fallback 1: BrasilAPI
    if (!titulo) {
      console.log('🔄 Tentando fallback na BrasilAPI...');
      const brasilResponse = await fetch(
        `https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`,
        { headers: { 'User-Agent': 'BibliotecaApp/1.0' } }
      );

      console.log(`📡 Status BrasilAPI: ${brasilResponse.status}`);

      if (brasilResponse.ok) {
        const info = await brasilResponse.json();
        titulo = info.title || null;
        subtitulo = info.subtitle || null;
        sinopse = info.synopsis || null;
        paginas = info.page_count || null;
        anoEdicao = info.year || null;
        nomeAutor = info.authors ? info.authors[0] : null;
        nomeEditora = info.publisher || null;

        if (info.cover_url) {
          urlCapa = info.cover_url;
        }
      }
    }

    // 3. Fallback 2: Open Library (Busca Capa se nenhuma API encontrou)
    if (!urlCapa) {
      console.log('🔄 Tentando buscar capa na Open Library...');
      const openLibraryUrl = `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg?default=false`;
      
      try {
        const checkCover = await fetch(openLibraryUrl, { method: 'HEAD' });
        if (checkCover.ok) {
          urlCapa = openLibraryUrl;
          console.log('🖼️ Capa encontrada na Open Library!');
        }
      } catch (err) {
        console.log('⚠️ Falha ao checar capa na Open Library');
      }
    }

    if (!titulo) {
      console.log('❌ Livro não encontrado em nenhuma das APIs.');
      return res.status(404).json({ erro: 'Livro não encontrado para este ISBN.' });
    }

    console.log(`✅ Livro encontrado: "${titulo}"`);
    console.log('🔍 URL da capa capturada:', urlCapa);

    if (urlCapa) {
      urlCapa = urlCapa.replace(/^http:\/\//i, 'https://');
    }

    // --- CADASTRO NO PRISMA ---
    let autor = null;
    if (nomeAutor) {
      let existente = await prisma.autor.findFirst({ where: { nome: nomeAutor } });
      autor = existente || await prisma.autor.create({ data: { nome: nomeAutor } });
    }

    const obra = await prisma.obra.create({
      data: {
        titulo,
        subtitulo,
        sinopse,
        autores: autor ? { connect: [{ id: autor.id }] } : undefined
      }
    });

    let editora = null;
    if (nomeEditora) {
      let existente = await prisma.editora.findFirst({ where: { nome: nomeEditora } });
      editora = existente || await prisma.editora.create({ data: { nome: nomeEditora } });
    }

    const exemplar = await prisma.exemplar.create({
      data: {
        obraId: obra.id,
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

    console.log('📸 Imagens salvas no exemplar:', exemplar.imagens);

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