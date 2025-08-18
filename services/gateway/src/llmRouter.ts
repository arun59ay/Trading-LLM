// services/gateway/src/llmRouter.ts
export type Provider = 'ollama' | 'openai';

export function chooseProvider(input: {
  task: 'embed'|'qa'|'format'|'summarize';
  promptLen: number;
  importance?: 'low'|'high';
}): Provider {
  const { task, promptLen, importance } = input;
  if (task === 'embed') return 'ollama';
  if (task === 'qa') {
    if (promptLen < 800 && importance !== 'high') return 'ollama';
    return 'openai';
  }
  if (task === 'format' || task === 'summarize') return importance === 'high' ? 'openai' : 'ollama';
  return 'ollama';
}
