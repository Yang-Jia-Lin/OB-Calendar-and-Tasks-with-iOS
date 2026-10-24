export interface AWBucket {
  id: string;
  type: string;
  client: string;
  hostname: string;
  created: string;
  name?: string;
}

export interface AWEvent {
  id: number;
  timestamp: string; // ISO8601 string
  duration: number; // in seconds
  data: {
    app?: string;
    title?: string;
    url?: string;
    audible?: boolean;
    incognito?: boolean;
    tabCount?: number;
    [key: string]: unknown;
  };
}
