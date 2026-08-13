// Quickstart do Headroom (https://headroom-docs.vercel.app/docs/quickstart)
// aplicado ao workspace: comprime uma conversa, envia ao LLM e mostra a economia.
//
// Passo 1 (instalar) já está feito: `headroom-ai` está em dependencies e o
// proxy Python (`headroom`) está instalado localmente.
// Este script cobre os passos 2 (comprimir), 3 (enviar ao LLM) e 4 (economia).
//
// Pré-requisitos de execução:
//   headroom proxy --port 8787        # obrigatório: a compressão roda no proxy
//   export OPENAI_API_KEY=...         # opcional: sem a chave o passo 3 é pulado
//
// Uso: node scripts/headroom-quickstart.mjs
// Sai com código 1 se o proxy estiver indisponível ou a chamada ao LLM falhar.

import { compress } from 'headroom-ai';

const baseUrl = process.env.HEADROOM_BASE_URL ?? 'http://localhost:8787';
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

// --- Passo 2: comprimir as mensagens ---------------------------------------

// Conversa de exemplo da documentação: um resultado de ferramenta com 500 itens
// domina a janela de contexto e é o alvo natural da compressão.
const messages = [
  { role: 'system', content: 'You analyze search results.' },
  { role: 'user', content: 'Search for Python tutorials.' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'search', arguments: '{"q": "python"}' },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'call_1',
    content: JSON.stringify({
      results: Array.from({ length: 500 }, (_, index) => ({
        title: `Result ${index}`,
        snippet: `Description ${index}`,
        score: 100 - index,
      })),
    }),
  },
  { role: 'user', content: 'What are the top 3 results?' },
];

let result;
try {
  result = await compress(messages, { model, baseUrl });
} catch (error) {
  console.error(`Falha ao comprimir via proxy em ${baseUrl}: ${error.message}`);
  console.error('Suba o proxy antes de rodar o script: headroom proxy --port 8787');
  process.exit(1);
}

// --- Passo 3: enviar ao LLM -------------------------------------------------

// O snippet TypeScript da documentação envia um array vazio; o correto é enviar
// `result.messages`, que é o que a versão Python do mesmo passo faz.
if (process.env.OPENAI_API_KEY) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: result.messages,
    });
    console.log('Resposta do modelo:');
    console.log(response.choices[0].message.content);
  } catch (error) {
    console.error(`Falha na chamada ao ${model}: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log('Passo 3 pulado: defina OPENAI_API_KEY para enviar ao modelo.');
}

// --- Passo 4: conferir a economia -------------------------------------------

console.log('');
console.log(`Tokens antes:  ${result.tokensBefore}`);
console.log(`Tokens depois: ${result.tokensAfter}`);
console.log(`Tokens salvos: ${result.tokensSaved}`);
// `compressionRatio` é o que sobrou do original, não o que foi economizado:
// o passo 4 da documentação rotula esse número como "Compression".
console.log(
  `Compressão:    ${(result.compressionRatio * 100).toFixed(0)}% do original ` +
    `(economia de ${((1 - result.compressionRatio) * 100).toFixed(0)}%)`,
);
console.log(`Transformações: ${result.transformsApplied.join(', ') || 'nenhuma'}`);
