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
  const { obraId } = req.body; // Pega o ID da obra atual se enviado pelo Flutter

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

    console.log(`Status Google Books: ${googleResponse.status}`);

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
    } else {
      console.log('Google Books falhou ou bloqueou a requisição.');
    }

    // 2. Fallback 1: BrasilAPI
    if (!titulo) {
      console.log('Tentando fallback na BrasilAPI...');
      const brasilResponse = await fetch(
        `https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`,
        { headers: { 'User-Agent': 'BibliotecaApp/1.0' } }
      );

      console.log(`Status BrasilAPI: ${brasilResponse.status}`);

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

    // 3. Fallback 2: Open Library (preenche metadados e capa se ainda faltarem)
    if (!titulo || !subtitulo || !sinopse || !paginas || !anoEdicao || !nomeAutor || !nomeEditora || !urlCapa) {
      console.log('Tentando fallback final na Open Library...');
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

            console.log('Metadados preenchidos pela Open Library.');
          }
        }
      } catch (err) {
        console.log('Falha ao consultar a Open Library para os dados do livro');
      }
    }

    if (!titulo) {
      console.log('Livro não encontrado em nenhuma das APIs.');
      return res.status(404).json({ erro: 'Livro não encontrado para este ISBN.' });
    }

    console.log(`Livro encontrado: "${titulo}"`);
    console.log('URL da capa capturada:', urlCapa);

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

    // --- CADASTRO NO PRISMA ---
    let targetObraId = obraId ? Number(obraId) : null;

    // Se NÃO passou um obraId, cria uma nova Obra
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

    // Cria o Exemplar VINCULADO à Obra correta (targetObraId)
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
        idioma: true
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
    const { editora } = req.body;
    let editoraConnect = undefined;
    if (editora) {
      let edExistente = await prisma.editora.findFirst({ where: { nome: editora } });
      if (!edExistente) {
        edExistente = await prisma.editora.create({ data: { nome: editora } });
      }
      editoraConnect = { connect: { id: edExistente.id } };
    }

    const exemplarAtualizado = await prisma.exemplar.update({
      where: { id: id },
      data: {
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        isbn: isbn || undefined,
        localizacao: localizacaoConnect,
        idioma: idiomaConnect,
        editora: editoraConnect
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

// Rota para deletar uma Obra (e seus exemplares vinculados) pelo ID
router.delete('/obras/:id', async (req, res) => {
  const id = Number(req.params.id);

  try {
    // 1. Opcional: deletar dependências manuais caso o seu banco não utilize onDelete: Cascade no Prisma
    await prisma.exemplar.deleteMany({
      where: { obraId: id },
    });

    // 2. Deleta a Obra
    await prisma.obra.delete({
      where: { id: id },
    });

    res.json({ mensagem: 'Obra excluída com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir obra:', err);
    res.status(500).json({ erro: err.message });
  }
});

// Rota para atualizar os dados da Obra (Título, Subtítulo, Sinopse, Autores)
router.put('/obras/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { titulo, subtitulo, sinopse, autores } = req.body;

  try {
    // Processa a lista de autores se for enviada em texto separado por vírgula
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
        set: autoresIds // Sobrescreve as conexões antigas com os novos autores
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

      // 1. Busca os registros paginados e o total de itens da entidade
      const [itens, totalItens] = await Promise.all([
        prisma[entidade].findMany({
          skip: skip,
          take: limite,
          include: includes[entidade] || undefined
        }),
        prisma[entidade].count()
      ]);

      // 2. Se a entidade for 'obra', faz também a contagem total de exemplares
      let totalExemplares = null;
      if (entidade === 'obra') {
        totalExemplares = await prisma.exemplar.count();
      }

      // 3. Retorna a resposta com o metadado `totalExemplares` incluso
      res.json({
        dados: itens,
        paginacao: {
          totalItens,                                    // Total de Obras
          totalExemplares: totalExemplares ?? totalItens, // Total de Exemplares (cópias)
          paginaAtual: pagina,
          itensPorPagina: limite,
          totalPaginas: Math.ceil(totalItens / limite)
        }
      });
    } catch (err) {
      res.status(500).json({ erro: err.message });
    }
  });

  router.post('/exemplares/manual', async (req, res) => {
  const { 
  targetObraId, 
  tituloEdicao, 
  isbn, 
  paginas, 
  anoEdicao, 
  editoraId,      
  localizacaoId, 
  idiomaId, 
  urlCapa 
} = req.body;

  try {
    let targetObraId = obraId ? Number(obraId) : null;

    // 1. Se não recebeu um obraId, cria a Obra básica com o título da edição
    if (!targetObraId) {
      const novaObra = await prisma.obra.create({
        data: {
          titulo: tituloEdicao || 'Obra sem título',
        }
      });
      targetObraId = novaObra.id;
    }

    // 2. Trata / Conecta a Editora (busca ou cria)
    let editoraConnect = undefined;
    if (nomeEditora) {
      let edExistente = await prisma.editora.findFirst({ where: { nome: nomeEditora } });
      if (!edExistente) {
        edExistente = await prisma.editora.create({ data: { nome: nomeEditora } });
      }
      editoraConnect = { connect: { id: edExistente.id } };
    }

    // 3. Trata / Conecta a Localização
    let localizacaoConnect = undefined;
    if (localizacao) {
      let locExistente = await prisma.localizacao.findFirst({ where: { descricao: localizacao } });
      if (!locExistente) {
        locExistente = await prisma.localizacao.create({ data: { descricao: localizacao } });
      }
      localizacaoConnect = { connect: { id: locExistente.id } };
    }

    // 4. Trata / Conecta o Idioma
    let idiomaConnect = undefined;
    if (idioma) {
      let idmExistente = await prisma.idioma.findFirst({ where: { nome: idioma } });
      if (!idmExistente) {
        idmExistente = await prisma.idioma.create({ data: { nome: idioma } });
      }
      idiomaConnect = { connect: { id: idmExistente.id } };
    }

    // 5. Cria o Exemplar vinculado à Obra e com as relações tratadas
    const exemplar = await prisma.exemplar.create({
      data: {
        obraId: targetObraId,
        tituloEdicao: tituloEdicao || null,
        isbn: isbn || null,
        paginas: paginas ? Number(paginas) : null,
        anoEdicao: anoEdicao ? Number(anoEdicao) : null,
        editoraId: editoraId ? Number(editoraId) : null,
        localizacaoId: localizacaoId ? Number(localizacaoId) : null,
        idiomaId: idiomaId ? Number(idiomaId) : null,

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