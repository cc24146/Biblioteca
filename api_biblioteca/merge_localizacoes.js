const prisma = require('./lib/prisma');

async function main() {
  const todasLocalizacoes = await prisma.localizacao.findMany();

  const grupos = new Map();
  for (const loc of todasLocalizacoes) {
    const chave = loc.descricao.normalize('NFC').trim().toLowerCase();
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(loc);
  }

  for (const [chave, grupo] of grupos) {
    if (grupo.length <= 1) continue;

    // Escolhe como "canônica" a que tiver mais letras maiúsculas (aposta que é a mais bem formatada)
    const canonica = grupo.reduce((melhor, atual) => {
      const maiusculasAtual = (atual.descricao.match(/[A-ZÀ-Ý]/g) || []).length;
      const maiusculasMelhor = (melhor.descricao.match(/[A-ZÀ-Ý]/g) || []).length;
      return maiusculasAtual > maiusculasMelhor ? atual : melhor;
    });

    const duplicadas = grupo.filter(loc => loc.id !== canonica.id);

    console.log(`Mesclando "${chave}": mantendo "${canonica.descricao}" (id ${canonica.id}), removendo ${duplicadas.map(d => `"${d.descricao}" (id ${d.id})`).join(', ')}`);

    for (const dup of duplicadas) {
      await prisma.exemplar.updateMany({
        where: { localizacaoId: dup.id },
        data: { localizacaoId: canonica.id },
      });
      await prisma.localizacao.delete({ where: { id: dup.id } });
    }
  }

  console.log('Concluído.');
}

main().finally(() => prisma.$disconnect());