# Publicar o Voz em Estudo no GitHub

## Antes de publicar
- Esta distribuição **não inclui** `backend/.env` nem tokens privados.
- Não envie seus backups do Supabase, gravações, nomes de estudantes nem outros dados pessoais.
- Se você já publicou segredos em commits anteriores, apague o histórico afetado e **revogue/rotacione as chaves** nos respectivos serviços. Apenas remover o arquivo do último commit não basta.
- O arquivo `backend/.env.example` é um modelo **sem credenciais reais**. Para executar o projeto localmente, copie suas configurações privadas da pasta funcional para `backend/.env`; ele continuará ignorado pelo Git.

## Criar repositório (recomendado: privado inicialmente)
1. Acesse https://github.com/new e crie `voz-em-estudo`, com **Private** selecionado.
2. Não marque a criação automática de README, .gitignore ou LICENSE: estes arquivos já estão no projeto.
3. Instale o Git no Windows se necessário: https://git-scm.com/downloads/win
4. Abra o PowerShell **na pasta extraída `VozEmEstudo_GITHUB_PRONTO`**, não na pasta antiga.
5. Execute:

```powershell
git init
git branch -M main
git add .
git status --short
git ls-files | Select-String '(^|/)(\.env$|node_modules/)|\.dump$'
git commit -m "feat: versão inicial do Voz em Estudo"
git remote add origin https://github.com/SEU_USUARIO/voz-em-estudo.git
git push -u origin main
```

Troque `SEU_USUARIO` pelo login da sua conta. A verificação `git ls-files` **deve retornar vazia** para os arquivos privados listados. Se não estiver vazia, **não faça commit nem push** antes de corrigir.

## Para alterações futuras
```powershell
git status
git add .
git commit -m "fix: melhorar tela de autenticação"
git push
```

O GitHub guarda o código; ele **não** publica automaticamente seu site como aplicativo operacional. O backend e o Supabase continuam exigindo configuração e hospedagem apropriadas.
