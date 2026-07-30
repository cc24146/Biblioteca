// backfill_ordenacao.js — rode uma vez com: node backfill_ordenacao.js
const prisma = require('./lib/prisma');
const { atualizarOrdenacaoAutor } = require('./routes/apiRoutes'); // ajuste o caminho conforme onde está seu arquivo

async function main() {
  const obras = await prisma.obra.findMany({ select: { id: true } });
  for (const obra of obras) {
    await atualizarOrdenacaoAutor(obra.id);
  }
  console.log(`${obras.length} obras atualizadas.`);
}

main().finally(() => prisma.$disconnect());