const buildPayload = (textContent, phoneNumber) => ({
  textContent: String(textContent || ''),
  sendNow: true,
  type: 'texto',
  sendDate: 0,
  phoneNumber: String(phoneNumber || ''),
});

export const sendWhatsAppMessage = async (textContent, phoneNumber) => {
  const token = localStorage.getItem('authToken');
  const response = await fetch('/api/message/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(buildPayload(textContent, phoneNumber)),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Erro ao enviar WhatsApp (${response.status})`);
  }
  return data;
};

export const sendWhatsAppMessages = async (messages = []) => {
  const results = [];
  for (const { textContent, phoneNumber } of messages) {
    results.push(await sendWhatsAppMessage(textContent, phoneNumber));
  }
  return results;
};
