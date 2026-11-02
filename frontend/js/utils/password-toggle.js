// A visualização é local: não envia a senha a nenhum serviço.
document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  const input = document.getElementById(button.dataset.togglePassword);
  if (!input) return;
  button.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  });
});
