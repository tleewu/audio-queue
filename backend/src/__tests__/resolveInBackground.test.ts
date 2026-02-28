import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    queueItem: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../resolvers/resolver', () => ({
  dispatch: vi.fn(),
}));

import { prisma } from '../lib/prisma';
import { dispatch } from '../resolvers/resolver';
import { resolveInBackground } from '../routes/queue';

describe('resolveInBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates item with resolved metadata on success', async () => {
    vi.mocked(dispatch).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Great Episode',
      publisher: 'Show Name',
      audioURL: 'https://cdn.example.com/ep.mp3',
      durationSeconds: 3600,
      thumbnailURL: 'https://cdn.example.com/thumb.jpg',
      originalURL: 'https://example.com/feed',
    });
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);

    await resolveInBackground('item-1', 'https://example.com/feed');

    expect(dispatch).toHaveBeenCalledWith('https://example.com/feed');
    expect(prisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: {
        title: 'Great Episode',
        sourceType: 'podcast',
        audioURL: 'https://cdn.example.com/ep.mp3',
        durationSeconds: 3600,
        thumbnailURL: 'https://cdn.example.com/thumb.jpg',
        publisher: 'Show Name',
        resolveStatus: 'resolved',
        resolveError: null,
      },
    });
  });

  it('marks YouTube external (no audioURL) as resolved', async () => {
    vi.mocked(dispatch).mockResolvedValue({
      sourceType: 'youtube',
      title: 'YouTube Video',
      publisher: 'Channel',
      audioURL: undefined,
      thumbnailURL: 'https://img.youtube.com/thumb.jpg',
      originalURL: 'https://youtube.com/watch?v=abc',
    });
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);

    await resolveInBackground('item-2', 'https://youtube.com/watch?v=abc');

    const updateCall = vi.mocked(prisma.queueItem.updateMany).mock.calls[0][0];
    expect(updateCall.data).toMatchObject({
      resolveStatus: 'resolved',
      resolveError: null,
    });
  });

  it('marks as failed when dispatch throws', async () => {
    vi.mocked(dispatch).mockRejectedValue(new Error('Network timeout'));
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);

    await resolveInBackground('item-3', 'https://example.com/bad');

    expect(prisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-3' },
      data: {
        resolveStatus: 'failed',
        resolveError: 'Network timeout',
      },
    });
  });

  it('no-ops when item was deleted mid-resolve', async () => {
    vi.mocked(dispatch).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Episode',
      audioURL: 'https://cdn.example.com/ep.mp3',
      originalURL: 'https://example.com/feed',
    });
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 0 } as any);

    // Should not throw
    await resolveInBackground('deleted-item', 'https://example.com/feed');

    expect(prisma.queueItem.updateMany).toHaveBeenCalled();
  });

  it('marks as failed with "No audio stream found" for unsupported result', async () => {
    vi.mocked(dispatch).mockResolvedValue({
      sourceType: 'unsupported',
      title: 'https://example.com/page',
      audioURL: undefined,
      originalURL: 'https://example.com/page',
    });
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);

    await resolveInBackground('item-4', 'https://example.com/page');

    const updateCall = vi.mocked(prisma.queueItem.updateMany).mock.calls[0][0];
    expect(updateCall.data).toMatchObject({
      resolveStatus: 'failed',
      resolveError: 'No audio stream found',
    });
  });
});
