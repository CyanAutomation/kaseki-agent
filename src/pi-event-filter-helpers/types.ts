export interface ProviderErrorSummary {
  type: 'model_unavailable' | 'provider_error' | 'provider_empty_assistant_turn' | 'malformed_tool_call';
  provider?: string;
  api?: string;
  model?: string;
  stop_reason?: string;
  response_id?: string;
  status_code?: number;
  error_code?: string;
  cloudflare_log_id?: string;
  gateway_event_id?: string;
  upstream_error?: string;
  retry_after?: string;
  routed_provider?: string;
  routed_model?: string;
  recovery_suggestion?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  message: string;
  retryable?: boolean;
}
