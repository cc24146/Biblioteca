const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Lista com os nomes dos modelos exatamente como definidos no schema.prisma (em minúsculo)
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

// Função que gera as 5 rotas (GET, GET por ID, POST, PUT, DELETE) para cada entidade
function criarRotasCrud(entidade) {
  
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

  // GET ALL - Listar todos
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

  // GET BY ID - Buscar por ID
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

  // POST - Criar novo
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

  // PUT - Atualizar por ID
  // Rota dedicada para atualização de Exemplares com Relações (Localização e Idioma)
  router.put('/exemplares/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { paginas, anoEdicao, localizacao, idioma, isbn } = req.body;

    try {
      // 1. Trata ou cria a Localização (se informada)
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

      // 2. Trata ou cria o Idioma (se informado)
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

      // 3. Atualiza o Exemplar no Banco
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

  // DELETE - Remover por ID
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

router.post('/exemplares/isbn/:isbn', async (req, res) => {
  // 1. Remove hífens, espaços e caracteres especiais do ISBN
  const cleanIsbn = req.params.isbn.replace(/[^0-9X]/gi, '');

  try {
    let titulo, subtitulo, sinopse, paginas, anoEdicao, nomeAutor, nomeEditora;

    // 2. Tenta buscar no Google Books
    let response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    let data = await response.json();
    let urlCapa = null;

    if (data.items && data.items.length > 0) {
      const info = data.items[0].volumeInfo;
      titulo = info.title || null;
      subtitulo = info.subtitle || null;
      sinopse = info.description || null;
      paginas = info.pageCount || null;
      anoEdicao = info.publishedDate ? parseInt(info.publishedDate.substring(0, 4)) : null;
      nomeAutor = info.authors ? info.authors[0] : null;
      nomeEditora = info.publisher || null;
      urlCapa = info.imageLinks.thumbnail.replace('http://', 'https://');
    } else {
      // 3. Fallback: Se não achar no Google, tenta a BrasilAPI (ótima para livros nacionais)
      response = await fetch(`https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`);
      if (response.ok) {
        const info = await response.json();
        titulo = info.title || null;
        subtitulo = info.subtitle || null;
        sinopse = info.synopsis || null;
        paginas = info.page_count || null;
        anoEdicao = info.year || null;
        nomeAutor = info.authors ? info.authors[0] : null;
        nomeEditora = info.publisher || null;
      }
    }

    if (!titulo) {
      return res.status(404).json({ erro: 'Livro não encontrado em nenhuma das bases para este ISBN.' });
    }

    // --- MANTÉM O RESTANTE DO CÓDIGO DE CADASTRO NO PRISMA AQUI ---
    
    // Cadastra Autor
    let autor = null;
    if (nomeAutor) {
      let existente = await prisma.autor.findFirst({ where: { nome: nomeAutor } });
      autor = existente || await prisma.autor.create({ data: { nome: nomeAutor } });
    }

    // Cadastra Obra
    const obra = await prisma.obra.create({
      data: {
        titulo: titulo,
        subtitulo,
        sinopse,
        autores: autor ? { connect: [{ id: autor.id }] } : undefined
      }
    });

    // Cadastra Editora
    let editora = null;
    if (nomeEditora) {
      let existente = await prisma.editora.findFirst({ where: { nome: nomeEditora } });
      editora = existente || await prisma.editora.create({ data: { nome: nomeEditora } });
    }

    // Cadastra Exemplar
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
        imagens: true
      }
      
    });

    // Checagem dos campos faltantes
    const camposFaltantes = [];
    if (!subtitulo) camposFaltantes.push('Subtítulo');
    if (!sinopse) camposFaltantes.push('Sinopse');
    if (!paginas) camposFaltantes.push('Páginas');
    if (!anoEdicao) camposFaltantes.push('Ano de Edição');
    if (!editora) camposFaltantes.push('Editora');
    if (!autor) camposFaltantes.push('Autor');
    if (!exemplar.localizacaoId) camposFaltantes.push('Localização');
    if (!exemplar.idiomaId) camposFaltantes.push('Idioma');

    console.log('📸 Imagem salva no exemplar:', exemplar.imagens);
    console.log('\n----------------------------------------');
    console.log(`📚 Livro cadastrado via ISBN: "${obra.titulo}"`);
    if (camposFaltantes.length > 0) {
      console.log('⚠️  Atenção! Os seguintes campos não foram encontrados e precisam ser preenchidos manualmente:');
      camposFaltantes.forEach(campo => console.log(`   - ${campo}`));
    } else {
      console.log('✅ Todos os dados principais foram preenchidos com sucesso!');
    }
    console.log('----------------------------------------\n');

    res.status(201).json({
      mensagem: 'Exemplar cadastrado com sucesso!',
      exemplar,
      camposFaltantes
    });

  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});
}

// Registra as rotas no router para cada item da lista 'modelos'
modelos.forEach(entidade => {
  criarRotasCrud(entidade);
});

module.exports = router;