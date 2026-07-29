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

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    return texto || null;
  }
  const texto = String(valor).trim();
  return texto || null;
}

function extrairCamposFaltantes({ titulo, nomeAutor, nomeEditora, paginas, anoEdicao }) {
  const campos = [];
  if (!titulo) campos.push('titulo');
  if (!nomeAutor) campos.push('autor');
  if (!nomeEditora) campos.push('editora');
  if (!paginas) campos.push('paginas');
  if (!anoEdicao) campos.push('anoEdicao');
  return campos;
}

// ==========================================
// 1. ROTAS CUSTOMIZADAS (Fora do Loop CRUD)
// ==========================================

// Rota para cadastrar livro/exemplar via ISBN
router.post('/exemplares/isbn/:isbn', async (req, res) => {
  const cleanIsbn = req.params.isbn.replace(/[^0-9X]/gi, '');
  const { obraId } = req.body;

  try {
    let titulo = null;
    let subtitulo = null;
    let sinopse = null;
    let paginas = null;
    let anoEdicao = null;
    let nomeAutor = null;
    let nomeEditora = null;
    let urlCapa = null;

    console.log(`\n🔎 Pesquisando ISBN: ${cleanIsbn}...`);

    // 1. Tenta buscar no Google Books
    const googleResponse = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`,
      { headers: { 'User-Agent': 'BibliotecaApp/1.0' } }
    );

    if (googleResponse.ok) {
      const data = await googleResponse.json();

      if (data.items && data.items.length > 0) {
        const info = data.items[0].volumeInfo;
        titulo = titulo || normalizarTexto(info.title);
        subtitulo = subtitulo || normalizarTexto(info.subtitle);
        sinopse = sinopse || normalizarTexto(info.description);
        paginas = paginas ?? (info.pageCount ? Number(info.pageCount) : null);
        anoEdicao = anoEdicao ?? (info.publishedDate ? Number(info.publishedDate.substring(0, 4)) : null);
        nomeAutor = nomeAutor || (info.authors && info.authors.length > 0 ? normalizarTexto(info.authors[0]) : null);
        nomeEditora = nomeEditora || normalizarTexto(info.publisher);

        if (!urlCapa && info.imageLinks) {
          urlCapa = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || null;
        }
      }
    }

    // 2. Fallback 1: BrasilAPI
    if (!titulo) {
      const brasilResponse = await fetch(
        `https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`,
        { headers: { 'User-Agent': 'BibliotecaApp/1.0' } }
      );

      if (brasilResponse.ok) {
        const info = await brasilResponse.json();
        titulo = titulo || normalizarTexto(info.title);
        subtitulo = subtitulo || normalizarTexto(info.subtitle);
        sinopse = sinopse || normalizarTexto(info.synopsis);
        paginas = paginas ?? (info.page_count ? Number(info.page_count) : null);
        anoEdicao = anoEdicao ?? (info.year ? Number(info.year) : null);
        nomeAutor = nomeAutor || (info.authors && info.authors.length > 0 ? normalizarTexto(info.authors[0]) : null);
        nomeEditora = nomeEditora || normalizarTexto(info.publisher);

        if (!urlCapa && info.cover_url) {
          urlCapa = info.cover_url;
        }
      }
    }

    // 3. Fallback 2: Open Library
    if (!titulo || !subtitulo || !sinopse || !paginas || !anoEdicao || !nomeAutor || !nomeEditora || !urlCapa) {
      const openLibraryUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&jscmd=data&format=json`;

      try {
        const openLibraryResponse = await fetch(openLibraryUrl, { headers: { 'User-Agent': 'BibliotecaApp/1.0' } });

        if (openLibraryResponse.ok) {
          const openLibraryData = await openLibraryResponse.json();
          const livroOpenLibrary = openLibraryData[`ISBN:${cleanIsbn}`];

          if (livroOpenLibrary) {
            titulo = titulo || normalizarTexto(livroOpenLibrary.title);
            subtitulo = subtitulo || normalizarTexto(livroOpenLibrary.subtitle);

            if (typeof livroOpenLibrary.description === 'string') {
              sinopse = sinopse || normalizarTexto(livroOpenLibrary.description);
            } else if (livroOpenLibrary.description && typeof livroOpenLibrary.description === 'object') {
              sinopse = sinopse || normalizarTexto(livroOpenLibrary.description.value);
            }

            paginas = paginas ?? (livroOpenLibrary.number_of_pages ? Number(livroOpenLibrary.number_of_pages) : null);
            anoEdicao = anoEdicao ?? (livroOpenLibrary.publish_date ? Number(livroOpenLibrary.publish_date.substring(0, 4)) : null);
            nomeAutor = nomeAutor || (Array.isArray(livroOpenLibrary.authors) && livroOpenLibrary.authors.length > 0 ? normalizarTexto(livroOpenLibrary.authors[0].name) : null);
            nomeEditora = nomeEditora || (Array.isArray(livroOpenLibrary.publishers) && livroOpenLibrary.publishers.length > 0 ? normalizarTexto(livroOpenLibrary.publishers[0].name || livroOpenLibrary.publishers[0]) : null);

            if (!urlCapa) {
              if (Array.isArray(livroOpenLibrary.covers) && livroOpenLibrary.covers.length > 0) {
                urlCapa = `https://covers.openlibrary.org/b/id/${livroOpenLibrary.covers[0]}-L.jpg`;
              } else if (livroOpenLibrary.cover && (livroOpenLibrary.cover.medium || livroOpenLibrary.cover.large || livroOpenLibrary.cover.small)) {
                urlCapa = livroOpenLibrary.cover.medium || livroOpenLibrary.cover.large || livroOpenLibrary.cover.small;
              }
            }
          }
        }
      } catch (err) {
        console.log('Falha ao consultar a Open Library');
      }
    }

    if (!titulo) {
      return res.status(404).json({ erro: 'Livro não encontrado para este ISBN.' });
    }

    if (urlCapa) {
      urlCapa = urlCapa.replace(/^http:\/\//i, 'https://');
    }

    const camposFaltantes = extrairCamposFaltantes({
      titulo,
      nomeAutor,
      nomeEditora,
      paginas,
      anoEdicao
    });

    let targetObraId = obraId ? Number(obraId) : null;

    if (!targetObraId) {
      let autor = null;
      if (nomeAutor) {
        let existente = await prisma.autor.findFirst({ where: { nome: nomeAutor } });
        autor = existente || await prisma.autor.create({ data: { nome: nomeAutor } });
      }

      const tituloFinal = titulo || `Livro ISBN ${cleanIsbn}`;

      const novaObra = await prisma.obra.create({
        data: {
          titulo: tituloFinal,
          subtitulo: subtitulo || null,
          sinopse: sinopse || null,
          autores: autor ? { connect: [{ id: autor.id }] } : undefined
        }
      });
      targetObraId = novaObra.id;
    }

    const obraResposta = await prisma.obra.findUnique({
      where: { id: targetObraId },
      include: { autores: true }
    });

    let editora = null;
    if (nomeEditora) {
      let existente = await prisma.editora.findFirst({ where: { nome: nomeEditora } });
      editora = existente || await prisma.editora.create({ data: { nome: nomeEditora } });
    }

    const exemplar = await prisma.exemplar.create({
      data: {
        obraId: targetObraId,
        editoraId: editora ? editora.id : null,
        isbn: cleanIsbn,
        tituloEdicao: titulo || null,
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        imagens: urlCapa 
          ? { create: [{ url: urlCapa, descricao: 'Capa do Exemplar' }] } 
          : undefined
      },
      include: {
        imagens: true,
        localizacao: true,
        idioma: true,
        editora: true
      }
    });

    res.status(201).json({
      mensagem: 'Exemplar cadastrado com sucesso!',
      camposFaltantes,
      obra: obraResposta,
      exemplar
    });

  } catch (err) {
    console.error('❌ Erro interno:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota para Cadastro Manual de Exemplar
router.post('/exemplares/manual', async (req, res) => {
  const { 
    obraId, 
    targetObraId,
    tituloEdicao, 
    isbn, 
    paginas, 
    anoEdicao, 
    editoraId,
    nomeEditora,
    editora,      
    localizacaoId,
    localizacao, 
    idiomaId, 
    idioma,
    urlCapa
  } = req.body;

  try {
    let finalObraId = obraId ? Number(obraId) : (targetObraId ? Number(targetObraId) : null);

    // 1. Se não recebeu um obraId, cria uma nova Obra com o título da edição
    if (!finalObraId) {
      const novaObra = await prisma.obra.create({
        data: {
          titulo: tituloEdicao || 'Obra sem título',
        }
      });
      finalObraId = novaObra.id;
    }

    // 2. Trata / Resolve Editora (ID direto ou busca por Nome)
    let finalEditoraId = editoraId ? Number(editoraId) : null;
    const txtEditora = nomeEditora || editora;
    if (!finalEditoraId && txtEditora) {
      let edExistente = await prisma.editora.findFirst({ where: { nome: txtEditora } });
      if (!edExistente) {
        edExistente = await prisma.editora.create({ data: { nome: txtEditora } });
      }
      finalEditoraId = edExistente.id;
    }

    // 3. Trata / Resolve Localização
    let finalLocalizacaoId = localizacaoId ? Number(localizacaoId) : null;
    if (!finalLocalizacaoId && localizacao) {
      let locExistente = await prisma.localizacao.findFirst({ where: { descricao: localizacao } });
      if (!locExistente) {
        locExistente = await prisma.localizacao.create({ data: { descricao: localizacao } });
      }
      finalLocalizacaoId = locExistente.id;
    }

    // 4. Trata / Resolve Idioma
    let finalIdiomaId = idiomaId ? Number(idiomaId) : null;
    if (!finalIdiomaId && idioma) {
      let idmExistente = await prisma.idioma.findFirst({ where: { nome: idioma } });
      if (!idmExistente) {
        idmExistente = await prisma.idioma.create({ data: { nome: idioma } });
      }
      finalIdiomaId = idmExistente.id;
    }

    // 5. Cria o Exemplar vinculado à Obra
    const exemplar = await prisma.exemplar.create({
      data: {
        obraId: finalObraId,
        tituloEdicao: tituloEdicao || null,
        isbn: isbn || null,
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        editoraId: finalEditoraId,
        localizacaoId: finalLocalizacaoId,
        idiomaId: finalIdiomaId,

        imagens: urlCapa 
          ? { create: [{ url: urlCapa, descricao: 'Capa do Exemplar' }] } 
          : undefined
      },
      include: {
        editora: true,
        localizacao: true,
        idioma: true,
        imagens: true
      }
    });

    res.status(201).json({
      mensagem: 'Exemplar manual cadastrado com sucesso!',
      exemplar
    });

  } catch (err) {
    console.error('❌ Erro ao cadastrar exemplar manual:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota dedicada para atualização de Exemplares com Relações
router.put('/exemplares/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { paginas, anoEdicao, localizacao, idioma, editora, isbn } = req.body;

  try {
    let finalLocalizacaoId = undefined;
    if (localizacao) {
      let locExistente = await prisma.localizacao.findFirst({
        where: { descricao: localizacao }
      });
      if (!locExistente) {
        locExistente = await prisma.localizacao.create({
          data: { descricao: localizacao }
        });
      }
      finalLocalizacaoId = locExistente.id;
    }

    let finalIdiomaId = undefined;
    if (idioma) {
      let idmExistente = await prisma.idioma.findFirst({
        where: { nome: idioma }
      });
      if (!idmExistente) {
        idmExistente = await prisma.idioma.create({
          data: { nome: idioma }
        });
      }
      finalIdiomaId = idmExistente.id;
    }

    let finalEditoraId = undefined;
    if (editora) {
      let edExistente = await prisma.editora.findFirst({ where: { nome: editora } });
      if (!edExistente) {
        edExistente = await prisma.editora.create({ data: { nome: editora } });
      }
      finalEditoraId = edExistente.id;
    }

    const exemplarAtualizado = await prisma.exemplar.update({
      where: { id: id },
      data: {
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        isbn: isbn || undefined,
        localizacaoId: finalLocalizacaoId,
        idiomaId: finalIdiomaId,
        editoraId: finalEditoraId
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

// Rota para atualizar os dados da Obra (Título, Subtítulo, Sinopse, Autores)
router.put('/obras/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { titulo, subtitulo, sinopse, autores } = req.body;

  try {
    let autoresConnect = undefined;
    if (autores && typeof autores === 'string') {
      const nomesAutores = autores.split(',').map(a => a.trim()).filter(a => a.length > 0);
      
      const autoresIds = await Promise.all(
        nomesAutores.map(async (nome) => {
          let existente = await prisma.autor.findFirst({ where: { nome } });
          if (!existente) {
            existente = await prisma.autor.create({ data: { nome } });
          }
          return { id: existente.id };
        })
      );

      autoresConnect = {
        set: autoresIds
      };
    }

    const obraAtualizada = await prisma.obra.update({
      where: { id },
      data: {
        titulo: titulo || undefined,
        subtitulo: subtitulo !== undefined ? subtitulo : undefined,
        sinopse: sinopse !== undefined ? sinopse : undefined,
        autores: autoresConnect,
      },
      include: {
        autores: true,
        exemplares: {
          include: {
            localizacao: true,
            idioma: true,
            imagens: true,
          },
        },
      },
    });

    res.json(obraAtualizada);
  } catch (err) {
    console.error('Erro ao atualizar obra:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota para deletar uma Obra (e seus exemplares vinculados) pelo ID
router.delete('/obras/:id', async (req, res) => {
  const id = Number(req.params.id);

  try {
    await prisma.exemplar.deleteMany({
      where: { obraId: id },
    });

    await prisma.obra.delete({
      where: { id: id },
    });

    res.json({ mensagem: 'Obra excluída com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir obra:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota para deletar um exemplar pelo ID
router.delete('/exemplares/:id', async (req, res) => {
  const id = Number(req.params.id);

  try {
    await prisma.exemplar.delete({
      where: { id: id },
    });

    res.json({ mensagem: 'Exemplar excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir exemplar:', err);
    res.status(500).json({ erro: err.message });
  }
});

// ==========================================
// 2. FUNÇÃO E GERADOR DE ROTAS GENÉRICAS (CRUD)
// ==========================================

function criarRotasCrud(entidade) {
  // GET ALL (Com suporte a Paginação)
  router.get(`/${entidade}s`, async (req, res) => {
    try {
      const pagina = parseInt(req.query.pagina) || 1;
      const limite = parseInt(req.query.limite) || 10;
      const skip = (pagina - 1) * limite;

      const [itens, totalItens] = await Promise.all([
        prisma[entidade].findMany({
          skip: skip,
          take: limite,
          include: includes[entidade] || undefined
        }),
        prisma[entidade].count()
      ]);

      let totalExemplares = null;
      if (entidade === 'obra') {
        totalExemplares = await prisma.exemplar.count();
      }

      res.json({
        dados: itens,
        paginacao: {
          totalItens,
          totalExemplares: totalExemplares ?? totalItens,
          paginaAtual: pagina,
          itensPorPagina: limite,
          totalPaginas: Math.ceil(totalItens / limite)
        }
      });
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

  // POST (Criação Genérica)
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

  // DELETE Genérico
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