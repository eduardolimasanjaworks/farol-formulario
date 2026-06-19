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

  return {
    primeiro_nome_lead: primeiroNomeLead || '[PRIMEIRO NOME DO LEAD]',
    nome_lead: nomeLead || '[NOME DO LEAD]',
    nome_assessor: nomeAssessor || '[NOME DO ASSESSOR]',
    whatsapp_lead: whatsappClienteFmt || '[WHATSAPP DO LEAD]',
    whatsapp_assessor: whatsappAssessor || '[WHATSAPP DO ASSESSOR]',
    data_reuniao: dataFormatada || '[DATA DA REUNIÃO]',
    horario_reuniao: horarioTexto || '--:--',
    virgula_primeiro_nome: primeiroNomeLead ? `, ${primeiroNomeLead}` : '',
    assessor: nomeAssessor || '[NOME DO ASSESSOR]',
    whatsapp_cliente: whatsappClienteFmt || '[WHATSAPP DO LEAD]',
    data: dataFormatada || '[DATA DA REUNIÃO]',
    horario: horarioTexto || '--:--',
  };
};
