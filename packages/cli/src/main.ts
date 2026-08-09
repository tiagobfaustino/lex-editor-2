#!/usr/bin/env node
// `lex process <entrada> --manifesto <arquivo> --output <arquivo>`
//
// A CLI não decide nada sobre conteúdo jurídico: lê argumentos, chama o
// adaptador e traduz o relatório em texto e código de saída.

import { descreverRelatorio } from '@lex-editor/legal-domain';

import { CODIGO_DE_SAIDA, executarProcess } from './processar-arquivo.js';

const USO = `Uso:
  lex process <entrada> --manifesto <arquivo.json> --output <arquivo.md> [--decisoes <arquivo.json>]

Códigos de saída:
  0  sucesso
  2  entrada inválida (arquivo ou manifesto)
  3  falha de parsing
  4  falha de identificação ou de validação estrutural
  5  falha de formatação
  6  falha de escrita
`;

const lerOpcao = (argumentos: readonly string[], nome: string): string | undefined => {
  const indice = argumentos.indexOf(nome);

  return indice === -1 ? undefined : argumentos[indice + 1];
};

export const executar = (argumentos: readonly string[]): number => {
  const [comando, ...resto] = argumentos;

  if (comando === undefined || comando === '--help' || comando === '-h') {
    process.stdout.write(USO);

    return comando === undefined ? CODIGO_DE_SAIDA.entrada : CODIGO_DE_SAIDA.ok;
  }

  if (comando !== 'process') {
    process.stderr.write(`Comando desconhecido: ${comando}\n\n${USO}`);

    return CODIGO_DE_SAIDA.entrada;
  }

  const entrada = resto[0];
  const manifesto = lerOpcao(resto, '--manifesto');
  const saida = lerOpcao(resto, '--output');
  const decisoes = lerOpcao(resto, '--decisoes');

  if (entrada === undefined || manifesto === undefined || saida === undefined) {
    process.stderr.write(`Argumentos obrigatórios ausentes.\n\n${USO}`);

    return CODIGO_DE_SAIDA.entrada;
  }

  const resultado = executarProcess({
    entrada,
    manifesto,
    saida,
    ...(decisoes === undefined ? {} : { decisoes }),
  });
  const descricao = descreverRelatorio(resultado.relatorio);

  if (resultado.codigo === CODIGO_DE_SAIDA.ok) {
    process.stdout.write(`${descricao}\n`);
  } else {
    process.stderr.write(`${descricao}\n`);
  }

  return resultado.codigo;
};

process.exitCode = executar(process.argv.slice(2));
