// @bebest/ai-provider — the ONLY sanctioned way for application code to call
// an AI provider (ADR-003: "no application code may import an AI provider
// SDK directly"). apps/api and any future agent code import from here, never
// from an `openai`/`@anthropic-ai/sdk`/etc. package directly.

export type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  ExtractionRequest,
  ExtractionResult,
  TokenUsage,
  JSONSchema,
  KnownProviderName,
  FetchLike,
} from './types.js';

export {
  MissingPromptVersionError,
  ProviderNotConfiguredError,
  ProviderRequestError,
  JsonParseError,
  SchemaValidationError,
  ExtractionValidationError,
  ProviderNotRegisteredError,
  NoAvailableProviderError,
} from './errors.js';

export { extractJsonCandidate, parseAndValidateJson } from './json.js';

export {
  BaseAIProvider,
  OllamaProvider,
  type OllamaProviderOptions,
  OpenAIProvider,
  type OpenAIProviderOptions,
  AnthropicProvider,
  type AnthropicProviderOptions,
  GoogleProvider,
  type GoogleProviderOptions,
  PerplexityProvider,
  type PerplexityProviderOptions,
} from './providers/index.js';

export {
  AIProviderRegistry,
  DEFAULT_TASK_DEFAULTS,
  type AIProviderRegistryOptions,
  type TaskDefaults,
} from './registry.js';

export {
  loadPromptTemplate,
  listPromptVersions,
  renderPrompt,
  promptVersionFor,
  PromptNotFoundError,
  MissingTemplateVariableError,
  type PromptTemplate,
  type LoadPromptOptions,
  type TemplateVariables,
} from './prompts/index.js';
