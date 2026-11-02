import { describe, expect, it } from 'vitest';

import { parseCapture } from './capture';

// 18/10/2026 é um domingo.
const TODAY = '2026-10-18';

describe('captura', () => {
  it('lê o exemplo inteiro', () => {
    expect(parseCapture('pagar a luz sexta #casa !alta', TODAY)).toEqual({
      title: 'pagar a luz',
      dueDate: '2026-10-23',
      tags: ['casa'],
      priority: 'HIGH',
    });
  });

  it('hoje e amanhã, com e sem acento, em qualquer lugar', () => {
    expect(parseCapture('hoje ligar para o banco', TODAY)).toMatchObject({
      title: 'ligar para o banco',
      dueDate: TODAY,
    });
    expect(parseCapture('Amanhã comprar pão', TODAY).dueDate).toBe('2026-10-19');
    expect(parseCapture('comprar pão amanha', TODAY)).toMatchObject({
      title: 'comprar pão',
      dueDate: '2026-10-19',
    });
    expect(parseCapture('revisar depois de amanhã', TODAY)).toMatchObject({
      title: 'revisar',
      dueDate: '2026-10-20',
    });
  });

  it('dia da semana é o próximo, nunca hoje', () => {
    expect(parseCapture('feira domingo', TODAY).dueDate).toBe('2026-10-25');
    expect(parseCapture('reunião segunda', TODAY).dueDate).toBe('2026-10-19');
    expect(parseCapture('reunião terça-feira', TODAY).dueDate).toBe('2026-10-20');
    expect(parseCapture('reunião na quarta feira com o João', TODAY)).toMatchObject({
      title: 'reunião com o João',
      dueDate: '2026-10-21',
    });
    expect(parseCapture('entregar até sábado', TODAY)).toMatchObject({
      title: 'entregar',
      dueDate: '2026-10-24',
    });
    expect(parseCapture('ver na sexta o boleto', TODAY)).toMatchObject({
      title: 'ver o boleto',
      dueDate: '2026-10-23',
    });
  });

  it('dia solto no meio do texto não é data', () => {
    expect(parseCapture('segunda via do boleto', TODAY)).toMatchObject({
      title: 'segunda via do boleto',
      dueDate: null,
    });
    expect(parseCapture('pagar quinta parcela do carro', TODAY).dueDate).toBeNull();
  });

  it('prazo fica no título que não é data', () => {
    expect(parseCapture('sextante novo', TODAY)).toMatchObject({
      title: 'sextante novo',
      dueDate: null,
    });
    expect(parseCapture('ler hojeando', TODAY).dueDate).toBeNull();
  });

  it('etiquetas sem repetir e prioridade com ou sem acento', () => {
    expect(parseCapture('a #Casa #casa #mercado-livre #ação', TODAY)).toMatchObject({
      title: 'a',
      tags: ['casa', 'mercado-livre', 'ação'],
    });
    expect(parseCapture('b !média', TODAY).priority).toBe('MEDIUM');
    expect(parseCapture('b !media', TODAY).priority).toBe('MEDIUM');
    expect(parseCapture('b !BAIXA', TODAY).priority).toBe('LOW');
    expect(parseCapture('b !alta !baixa', TODAY).priority).toBe('HIGH');
  });

  it('o que não é marcador fica no título', () => {
    expect(parseCapture('ver site.com/#topo que legal!', TODAY)).toEqual({
      title: 'ver site.com/#topo que legal!',
      dueDate: null,
      tags: [],
      priority: null,
    });
    expect(parseCapture('c !altamente', TODAY)).toMatchObject({
      title: 'c !altamente',
      priority: null,
    });
  });

  it('só marcadores deixa o título vazio', () => {
    expect(parseCapture('amanhã #casa', TODAY).title).toBe('');
  });
});
