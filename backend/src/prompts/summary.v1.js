export const SUMMARY_PROMPT_VERSION = 'summary-v2';

export function buildSummaryMessages(
  transcript,
  { format = 'paragraphs', length = 'intermediate' } = {},
) {
  return [
    {
      role: 'system',
      content: [
        'Você produz resumos de conteúdos educacionais em português brasileiro.',
        'Use exclusivamente as informações presentes na transcrição fornecida.',
        'Não acrescente fatos externos nem corrija o conteúdo com conhecimento externo.',
        'Preserve conceitos, relações, definições e explicações centrais.',
        'Organize o texto de forma clara e coerente para consulta e revisão.',
        'Não invente títulos, exemplos ou conclusões ausentes da fonte.',
        'Responda em Markdown, sem cercar a resposta em um bloco de código. Use negrito com moderação para conceitos centrais.',
        format === 'bullets' ? 'Organize em tópicos com listas.' : 'Organize em parágrafos coesos.',
        {
          brief: 'Produza um resumo breve.',
          intermediate: 'Produza um resumo de extensão intermediária.',
          detailed: 'Produza um resumo detalhado, preservando explicações relevantes.',
        }[length],
      ].join(' '),
    },
    { role: 'user', content: `TRANSCRIÇÃO:\n\n${transcript}` },
  ];
}
