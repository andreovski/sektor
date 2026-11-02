import type { CategoryKind } from '@sektor/contract';

// Categorias com que o app nasce. A pessoa renomeia e apaga como quiser; só a `key` fica fixa.
export type DefaultCategory = {
  key: string;
  name: string;
  icon: string;
  color?: string;
  since: number;
  /** Nomes antigos desta padrão: a categoria com esse nome ganha o nome novo. */
  previousNames?: string[];
  children?: DefaultCategory[];
};


const sub = (key: string, name: string, icon: string): DefaultCategory => ({
  key,
  name,
  icon,
  since: 1,
});

export const DEFAULT_CATEGORIES: Record<CategoryKind, DefaultCategory[]> = {
  INCOME: [
    { key: 'salario', name: 'Salário', icon: 'briefcase', color: '#34c759', since: 0 },
    {
      key: 'alugueis-recebidos',
      name: 'Aluguéis recebidos',
      icon: 'key-round',
      color: '#af52de',
      since: 1,
    },
    {
      key: 'aposentadoria',
      name: 'Aposentadoria e pensões',
      icon: 'armchair',
      color: '#a2845e',
      since: 1,
    },
    {
      key: 'auxilio-governo',
      name: 'Auxílio do governo',
      icon: 'hand-helping',
      color: '#32ade6',
      since: 1,
    },
    {
      key: 'renda-extra',
      name: 'Renda extra',
      icon: 'coins',
      color: '#ff9500',
      since: 1,
    },
    {
      key: 'rendimentos-investimento',
      name: 'Rendimentos de investimento',
      icon: 'trending-up',
      color: '#007aff',
      since: 1,
    },
    {
      key: 'bonus',
      name: 'Bônus',
      icon: 'award',
      color: '#ffcc00',
      since: 1,
    },
    {
      key: 'outras-receitas',
      name: 'Outras receitas',
      icon: 'plus-circle',
      color: '#00c7be',
      since: 0,
    },
  ],
  EXPENSE: [
    {
      key: 'moradia',
      name: 'Moradia',
      icon: 'home',
      color: '#af52de',
      since: 0,
      children: [
        sub('moradia.agua', 'Água', 'droplet'),
        sub('moradia.luz', 'Luz', 'zap'),
        sub('moradia.aluguel', 'Aluguel', 'key-round'),
        sub('moradia.condominio', 'Condomínio', 'building'),
        sub('moradia.financiamento', 'Financiamento', 'house-plus'),
        sub('moradia.internet', 'Internet e telefone', 'wifi'),
        sub('moradia.reformas', 'Reformas', 'hammer'),
        sub('moradia.gas', 'Gás', 'flame'),
      ],
    },
    { key: 'mercado', name: 'Mercado', icon: 'shopping-cart', color: '#ff9500', since: 0 },
    {
      key: 'alimentacao',
      name: 'Alimentação',
      icon: 'utensils',
      color: '#ff3b30',
      since: 0,
      children: [
        sub('alimentacao.delivery', 'Delivery', 'motorbike'),
        sub('alimentacao.restaurantes', 'Restaurantes', 'chef-hat'),
        sub('alimentacao.bares', 'Bares', 'beer'),
      ],
    },
    {
      key: 'transporte',
      name: 'Transporte',
      icon: 'car',
      color: '#007aff',
      since: 0,
      children: [
        sub('transporte.apps', 'Aplicativos de mobilidade', 'car-taxi-front'),
        sub('transporte.combustivel', 'Combustível', 'fuel'),
        sub('transporte.estacionamento', 'Estacionamento e pedágio', 'circle-parking'),
        sub('transporte.ipva', 'IPVA e licenciamento', 'id-card'),
        sub('transporte.manutencao', 'Manutenção de veículo', 'wrench'),
        sub('transporte.publico', 'Transporte público', 'bus'),
      ],
    },
    {
      key: 'saude',
      name: 'Saúde e bem-estar',
      icon: 'heart-pulse',
      color: '#ff2d55',
      since: 0,
      previousNames: ['Saúde'],
      children: [
        sub('saude.academia', 'Academia e fitness', 'dumbbell'),
        sub('saude.bem-estar', 'Bem-estar', 'flower'),
        sub('saude.consultas', 'Consultas e tratamentos', 'stethoscope'),
        sub('saude.dentista', 'Dentista', 'toothbrush'),
        sub('saude.farmacia', 'Farmácia e medicamentos', 'pill'),
        sub('saude.planos', 'Planos de saúde', 'shield-plus'),
        sub('saude.optica', 'Óptica', 'glasses'),
      ],
    },
    { key: 'lazer', name: 'Lazer', icon: 'party-popper', color: '#ffcc00', since: 0 },
    { key: 'assinaturas', name: 'Assinaturas', icon: 'repeat', color: '#5856d6', since: 0 },
    {
      key: 'educacao',
      name: 'Educação e desenvolvimento',
      icon: 'graduation-cap',
      color: '#32ade6',
      since: 0,
      previousNames: ['Educação'],
      children: [
        sub('educacao.cursos', 'Cursos e treinamentos', 'presentation'),
        sub('educacao.livros', 'Livros e materiais', 'book-open'),
        sub('educacao.material-escolar', 'Material escolar', 'backpack'),
        sub('educacao.mensalidade', 'Mensalidade escolar', 'school'),
      ],
    },
    {
      key: 'investimento',
      name: 'Investimento',
      icon: 'chart-candlestick',
      color: '#34c759',
      since: 1,
      children: [
        sub('investimento.acoes', 'Ações e fundos', 'chart-candlestick'),
        sub('investimento.cripto', 'Criptomoedas', 'bitcoin'),
        sub('investimento.proventos', 'Proventos de investimento', 'coins'),
        sub('investimento.renda-fixa', 'Renda fixa', 'vault'),
      ],
    },
    {
      key: 'pets',
      name: 'Pets',
      icon: 'paw-print',
      color: '#a2845e',
      since: 1,
      children: [
        sub('pets.petshop', 'Petshop e acessórios', 'dog'),
        sub('pets.racao', 'Ração e alimentação', 'bone'),
        sub('pets.veterinario', 'Veterinário e medicamentos', 'stethoscope'),
      ],
    },
    {
      key: 'seguros',
      name: 'Seguros',
      icon: 'shield-check',
      color: '#00c7be',
      since: 1,
      children: [
        sub('seguros.automovel', 'Seguro de automóvel', 'car-front'),
        sub('seguros.vida', 'Seguro de vida', 'heart-handshake'),
        sub('seguros.residencial', 'Seguro residencial', 'house-heart'),
      ],
    },
    {
      key: 'taxas',
      name: 'Taxas',
      icon: 'percent',
      color: '#8e8e93',
      since: 1,
      children: [
        sub('taxas.bancarias', 'Taxas bancárias', 'landmark'),
        sub('taxas.imposto', 'Imposto', 'file-text'),
      ],
    },
    {
      key: 'servicos',
      name: 'Serviços',
      icon: 'concierge-bell',
      color: '#5856d6',
      since: 1,
    },
    {
      key: 'viagem',
      name: 'Viagem',
      icon: 'plane',
      color: '#32ade6',
      since: 1,
      children: [
        sub('viagem.alimentacao', 'Alimentação em viagem', 'utensils'),
        sub('viagem.hospedagem', 'Hospedagem', 'bed-double'),
        sub('viagem.passagens', 'Passagens e transporte', 'tickets-plane'),
        sub('viagem.passeios', 'Passeios e lazer', 'camera'),
        sub('viagem.bares', 'Bares em viagem', 'beer'),
      ],
    },
    {
      key: 'emergencia',
      name: 'Emergência',
      icon: 'siren',
      color: '#ff3b30',
      since: 1,
      children: [sub('emergencia.despesas', 'Despesas emergenciais', 'triangle-alert')],
    },
    {
      key: 'outras-despesas',
      name: 'Outras despesas',
      icon: 'circle-ellipsis',
      color: '#8e8e93',
      since: 0,
    },
  ],
};
