/// <reference types="jest" />

class MockResponse {
  status: number;
  headers: Record<string, string>;
  constructor(
    public body: string | null,
    public init: { status?: number; headers?: Record<string, string> }
  ) {
    this.status = init?.status || 200;
    this.headers = init?.headers || {};
  }
  text(): Promise<string> {
    return Promise.resolve(this.body ?? '');
  }
}
window.Response = MockResponse as unknown as typeof Response;

const mockRequestUrl = jest.fn();
const mockRequest = jest.fn();
const mockPlatform = { isMobile: false };

jest.mock('obsidian', () => ({
  requestUrl: mockRequestUrl,
  request: mockRequest,
  Platform: mockPlatform
}));

import { obsidianFetch } from './obsidian-fetch_caldav';

describe('obsidianFetch', () => {
  beforeEach(() => {
    mockPlatform.isMobile = false;
    mockRequestUrl.mockReset();
    mockRequest.mockReset();
  });

  it('uses requestUrl result on desktop', async () => {
    mockRequestUrl.mockResolvedValueOnce({
      status: 207,
      text: '<ok/>',
      headers: {}
    });

    const res = await obsidianFetch('https://example.com/caldav/', { method: 'PROPFIND' });

    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(207);
    expect(await res.text()).toBe('<ok/>');
  });

  it('falls back to request on mobile when requestUrl throws', async () => {
    mockPlatform.isMobile = true;
    mockRequestUrl.mockRejectedValueOnce(new Error('requestUrl blocked'));
    mockRequest.mockResolvedValueOnce('<fallback/>');

    const res = await obsidianFetch('https://example.com/caldav/', {
      method: 'PROPFIND',
      body: '<xml/>'
    });

    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<fallback/>');
  });

  it('falls back to request on mobile when requestUrl returns invalid status', async () => {
    mockPlatform.isMobile = true;
    mockRequestUrl.mockResolvedValueOnce({
      status: 0,
      text: '',
      headers: {}
    });
    mockRequest.mockResolvedValueOnce('<fallback/>');

    const res = await obsidianFetch('https://example.com/caldav/', { method: 'REPORT' });

    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<fallback/>');
  });

  it('rethrows requestUrl errors on desktop', async () => {
    mockPlatform.isMobile = false;
    mockRequestUrl.mockRejectedValueOnce(new Error('desktop failure'));

    await expect(obsidianFetch('https://example.com/caldav/')).rejects.toThrow('desktop failure');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
