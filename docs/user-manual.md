# Manual de uso — permissão, transcrição e geração

> ⚠️ **Documento histórico.** Descreve o fluxo da etapa E02, com o áudio enviado só ao Hugging Face. Para a situação atual, veja [FUNCIONALIDADES.md](FUNCIONALIDADES.md).


Este fluxo pertence à implementação local E02. A ativação no ambiente compartilhado depende da migration e do aceite descritos no relatório E02.

## Enviar uma gravação

Escolha o arquivo, o trecho, o título, a disciplina e 3, 5, 10 ou 20 questões. A revisão do envio mostra nome, disciplina, formato, duração/recorte, conservação e quantidade de questões. Confirme as escolhas antes do botão final; durante o envio, o botão impede uma segunda submissão.

A declaração de permissão começa desmarcada. Leia-a e confirme apenas se possuir permissão para usar a gravação e enviá-la aos serviços indicados. O site registra a versão do texto, sua conta, o material e a data; isso é uma declaração da pessoa, não verificação automática de direitos autorais. Materiais antigos também exigem a declaração atual antes de novo processamento. Se o texto mudar, a interface pede nova confirmação.

A escolha de conservar áudio é independente da declaração. Sem conservação, o áudio temporário é removido depois que a transcrição fica armazenada; o texto continua acessível e o player original fica indisponível. Na implementação atual, o áudio conservado é o WAV do recorte processado. O MP4 original não é conservado no site nesta etapa.

O áudio é enviado ao serviço de reconhecimento configurado em Hugging Face; o texto é enviado ao provedor generativo Groq para avisos, resumos e questões. As políticas externas devem ser consultadas pelo responsável da instalação; o site não garante prazos de eliminação que não tenham sido verificados. Para MP4/MOV, a IA recebe somente a faixa de áudio: slides, imagens e fórmulas visuais não são analisados.

## Conferir e confirmar a transcrição

Depois do ASR, a aula mostra “Transcrição pronta para conferência” e “Aguardando confirmação”. Use “Conferir transcrição” para ir ao primeiro trecho real, ou navegue pelos trechos e pelo player quando o áudio estiver disponível. Edite e salve o que precisar. Em seguida, use “Conferir e confirmar transcrição”. Confirmar registra a revisão conferida e libera geração; não atesta a veracidade da aula.

“Pronto para gerar” habilita resumo e novos lotes. A geração usa aquela revisão. Se você editar enquanto um job aguarda ou roda, o job continua ligado à fonte anterior. Para gerar sobre a edição, salve e confirme a nova revisão. Restaurar uma revisão antiga cria uma nova revisão e exige outra confirmação; não substitui o histórico.

O resumo e os lotes anteriores continuam disponíveis. A indicação “a revisão atual mudou” informa que a fonte é outra, sem afirmar que o conteúdo anterior esteja incorreto. “Marcar revisão concluída” registra progresso pessoal no navegador; é diferente da confirmação da transcrição usada pelo servidor para gerar materiais.

## Avisos preliminares

Abra “Avisos preliminares” para ver adequação educacional, relação com a disciplina e suspeita factual. Cada análise pode sugerir conferência, indicar contexto insuficiente, informar indisponibilidade ou não detectar indícios. Nenhum desses estados é certificado de verdade ou falsidade. Ironia, citação para refutação, ficção, hipótese e conversa ambígua precisam de interpretação humana.

“Conferir trecho” abre o texto e o intervalo do snapshot analisado. Quando o aviso é de uma revisão anterior, a referência continua nessa revisão. “Analisar esta revisão novamente” registra uma nova análise e preserva as anteriores no banco. O painel mostra resultados recentes; edição não reaproveita avisos antigos como se fossem da nova fonte.

## Falhas e acessibilidade

Falha de geração não apaga a transcrição nem versões anteriores. Falhas temporárias têm retry do worker; geração concluída é reutilizada no mesmo job. Se houver erro de configuração/migration, o processamento fica bloqueado até a instalação ser preparada. Uma falha de limpeza/conservação pode deixar o áudio pendente até a retomada; o responsável deve acompanhar jobs esgotados.

Os controles têm rótulos, status anunciados e navegação de teclado. Fonte ampliada e modo foco são mantidos; o painel de avisos é recolhível e a sidebar pode ser reaberta. A avaliação automática de acessibilidade não substitui teste com leitor de tela real.
