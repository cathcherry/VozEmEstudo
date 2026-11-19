import { env } from '../config/env.js';
import { errors } from '../domain/errors.js';
import { createAiConfig, snapshotTask } from './provider-config.js';
import { assertTextGenerationProvider } from './contracts/text-generation.js';
import { assertTranscriptionProvider } from './contracts/transcription.js';
import { createGroqProvider } from '../integrations/llm/groq.client.js';
import { createAssemblyAiGatewayProvider } from '../integrations/llm/assemblyai-gateway.client.js';
import { createHuggingFaceProvider } from '../integrations/asr/huggingface-whisper.client.js';
import { createAssemblyAiProvider } from '../integrations/asr/assemblyai.client.js';

/** Vendor factories. Each receives the resolved config and returns a contract-conforming adapter. */
export const defaultFactories = Object.freeze({
  text: {
    groq: (config, { mock }) => createGroqProvider({ apiKey: config.credentials.groq, mock }),
    // MOCK_EXTERNAL_SERVICES reuses the offline demo outputs; no request leaves the server.
    'assemblyai-gateway': (config, { mock }) =>
      mock
        ? { ...createGroqProvider({ apiKey: '', mock: true }), name: 'assemblyai-gateway' }
        : createAssemblyAiGatewayProvider({
            apiKey: config.credentials.assemblyai,
            baseUrl: config.endpoints.assemblyaiGateway,
            jsonMode: config.endpoints.assemblyaiGatewayJsonMode,
          }),
  },
  transcription: {
    huggingface: () => createHuggingFaceProvider(),
    assemblyai: (config, { mock }) =>
      createAssemblyAiProvider({
        apiKey: config.credentials.assemblyai,
        baseUrl: config.endpoints.assemblyai,
        mock,
      }),
  },
});

export function createProviderRegistry({
  config = createAiConfig(),
  factories = defaultFactories,
  mock = env.mockExternalServices,
} = {}) {
  const cache = new Map();
  function instance(kind, name) {
    const key = kind + ':' + name;
    if (!cache.has(key)) {
      const factory = factories[kind]?.[name];
      // No hidden fallback: an unavailable provider is an explicit configuration error.
      if (!factory)
        throw errors.configuration([`${kind === 'text' ? 'LLM' : 'ASR'}_PROVIDER=${name}`]);
      const adapter = factory(config, { mock });
      cache.set(
        key,
        kind === 'text'
          ? assertTextGenerationProvider(adapter)
          : assertTranscriptionProvider(adapter),
      );
    }
    return cache.get(key);
  }
  return {
    config,
    /** Snapshot of the provider/model a new job must keep using, regardless of later env changes. */
    snapshot: (task) => snapshotTask(config, task),
    transcription(snapshot = snapshotTask(config, 'transcription')) {
      return { provider: instance('transcription', snapshot.provider), snapshot };
    },
    /** Text generator bound to one task; `snapshot` (from a job) overrides the live config. */
    text(task, snapshot = snapshotTask(config, task)) {
      if (!snapshot.model) throw errors.configuration([`LLM_${task.toUpperCase()}_MODEL`]);
      const provider = instance('text', snapshot.provider);
      const bind = (method) => (args) => provider[method]({ ...args, model: snapshot.model });
      return {
        provider: snapshot.provider,
        model: snapshot.model,
        completeText: bind('completeText'),
        completeJson: bind('completeJson'),
      };
    },
  };
}

let registry;
export function getAiRegistry() {
  if (!registry) registry = createProviderRegistry();
  return registry;
}
/** Test seam: replaces the process-wide registry (pass null to rebuild from the environment). */
export function setAiRegistry(value) {
  registry = value;
}
