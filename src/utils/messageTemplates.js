export const DEFAULT_TEMPLATES = {
  cliente: `Olá {{primeiro_nome_lead}}

Conforme conversamos, você será atendido pelo assessor {{nome_assessor}}, se quiser tirar uma dúvida, esse é o número dele:
{{whatsapp_assessor}}

A reunião ficou marcada para {{data_reuniao}}, {{horario_reuniao}}.`,
  assessor: `Olá {{nome_assessor}}

Agendada uma nova reunião com o lead {{nome_lead}} (WhatsApp: {{whatsapp_lead}}), para a data {{data_reuniao}}, {{horario_reuniao}}.

Já está vinculado na sua agenda.`,
};

/** Variáveis disponíveis nas copys — nomes autoexplicativos */
export const TEMPLATE_VARIABLES = [
  { key: 'primeiro_nome_lead', label: 'Primeiro nome do lead' },
  { key: 'nome_lead', label: 'Nome completo do lead' },
  { key: 'nome_assessor', label: 'Nome do assessor' },
  { key: 'whatsapp_lead', label: 'WhatsApp do lead' },
  { key: 'whatsapp_assessor', label: 'WhatsApp do assessor' },
  { key: 'data_reuniao', label: 'Data da reunião' },
  { key: 'horario_reuniao', label: 'Horário da reunião' },
];

export const TEMPLATE_PLACEHOLDERS = TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`);

export const renderMessageTemplate = (template = '', vars = {}) =>
  String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');

export const buildMessageTemplateVars = ({
  assessor = '',
  cliente = '',
  whatsappAssessor = '',
  whatsappClienteFmt = '',
  dataFormatada = '',
  horarioTexto = '',
}) => {
  const nomeLead = String(cliente || '').trim();
  const primeiroNomeLead = nomeLead.split(/\s+/)[0] || '';
  const nomeAssessor = String(assessor || '').trim();

  const vars = {
    primeiro_nome_lead: primeiroNomeLead || '[PRIMEIRO NOME DO LEAD]',
    nome_lead: nomeLead || '[NOME DO LEAD]',
    nome_assessor: nomeAssessor || '[NOME DO ASSESSOR]',
    whatsapp_lead: whatsappClienteFmt || '[WHATSAPP DO LEAD]',
    whatsapp_assessor: whatsappAssessor || '[WHATSAPP DO ASSESSOR]',
    data_reuniao: dataFormatada || '[DATA DA REUNIÃO]',
    horario_reuniao: horarioTexto || '--:--',
    // aliases legados (templates antigos no banco continuam funcionando)
    virgula_primeiro_nome: primeiroNomeLead ? `, ${primeiroNomeLead}` : '',
    assessor: nomeAssessor || '[NOME DO ASSESSOR]',
    whatsapp_cliente: whatsappClienteFmt || '[WHATSAPP DO LEAD]',
    data: dataFormatada || '[DATA DA REUNIÃO]',
    horario: horarioTexto || '--:--',
  };

  return vars;
};
