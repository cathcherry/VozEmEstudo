const banner = document.createElement('aside');
banner.setAttribute('aria-label', 'Ambiente de apresentação');
banner.className = 'presentation-banner';
banner.textContent =
  'Apresentação local · dados fictícios · sem IA ou login real. Aulas e envios são reiniciados ao fechar o servidor. ';
const library = document.createElement('a');
library.href = '/painel.html';
library.textContent = 'Abrir painel';
banner.append(library);
(document.querySelector('main') || document.body).prepend(banner);
if (location.pathname === '/login.html') {
  const form = document.querySelector('.login-form');
  if (form) {
    form.querySelectorAll('input').forEach((input) => {
      input.required = false;
      input.disabled = true;
    });
    const submit = form.querySelector('[type="submit"]');
    submit.textContent = 'Entrar na demonstração';
  }
}
if (location.pathname === '/nova-transcricao.html') {
  const note = document.createElement('p');
  note.className = 'plain-note';
  note.textContent =
    'Use somente arquivos de teste. O áudio fica neste computador enquanto o servidor está aberto. A transcrição e as questões são exemplos fixos, sem relação com o arquivo enviado. Recortes reais exigem as dependências opcionais de mídia (consulte APRESENTACAO.md).';
  document.querySelector('main')?.prepend(note);
}

// The integrated upload disclosure is replaced only in the local presentation DOM.
for (const note of document.querySelectorAll('p.plain-note')) {
  if (note.textContent.includes('Hugging Face') && note.textContent.includes('Groq'))
    note.textContent =
      'Nesta apresentação, o arquivo é processado apenas neste computador. Não há envio ao Hugging Face ou à Groq. Transcrição, resumo e questões são exemplos locais.';
}

// The live session reuses the same UI, but the API responses are genuinely generated.
fetch('/api/config').then((res) => res.json()).then((config) => {
  if (!config.liveAi) return;
  banner.firstChild.textContent = 'IA REAL · transcrição com Hugging Face/Whisper · resumo e questões com Groq. Login e biblioteca temporários nesta sessão. ';
  const note = document.querySelector('main > p.plain-note');
  if (location.pathname === '/nova-transcricao.html' && note)
    note.textContent = 'Transcrição real: o áudio selecionado será enviado ao Whisper via Hugging Face. Após conferir a transcrição, você poderá gerar um resumo real via Groq. Dados armazenados apenas nesta sessão; sem Supabase. Use somente gravações com permissão.';
  for (const paragraph of document.querySelectorAll('p.plain-note')) {
    if (paragraph.textContent.includes('Não há envio ao Hugging Face ou à Groq'))
      paragraph.textContent = 'O áudio preparado é enviado à Hugging Face para transcrição e a transcrição é enviada à Groq para geração. Os resultados desta sessão ficam na memória local e não são gravados no Supabase.';
  }
}).catch(() => {});
