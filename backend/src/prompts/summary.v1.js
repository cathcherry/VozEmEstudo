export const SUMMARY_PROMPT_VERSION = 'summary-v1';

export function buildSummaryMessages(transcript) {
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
      ].join(' '),
    },
    { role: 'user', content: `TRANSCRIÇÃO:\n\n${transcript}` },
  ];
}
