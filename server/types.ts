export interface FcgEnvelope<T> {
  request_id?: string;
  trace_id?: string;
  downstream_request_id?: string;
  code: string;
  message: string;
  data: T;
}

export interface FcgCredentials {
  appKey: string;
  appSecret: string;
}

export interface SignInput extends FcgCredentials {
  method: string;
  path: string;
  query?: URLSearchParams | Record<string, string | number | undefined>;
  body?: string;
  timestamp?: string;
  nonce?: string;
}
