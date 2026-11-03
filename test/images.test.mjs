import assert from 'node:assert/strict';
import test from 'node:test';
import { imageBlocks, imageRefs, isSlackFileUrl, pickImageUrl } from '../src/images.mjs';

test('collects unique image refs and caps the count', () => {
  const messages = [
    {
      files: [
        { id: 'F1', name: 'shot.png', mimetype: 'image/png' },
        { id: 'F2', name: 'notes.txt', mimetype: 'text/plain' },
      ],
    },
    {
      files: [
        { id: 'F1', name: 'shot.png', mimetype: 'image/png' },
        { id: 'F3', mimetype: 'image/jpeg' },
      ],
    },
  ];

  assert.deepEqual(imageRefs(messages), [
    { id: 'F1', name: 'shot.png', mimetype: 'image/png' },
    { id: 'F3', name: null, mimetype: 'image/jpeg' },
  ]);

  const many = Array.from({ length: 6 }, (_, index) => ({
    files: [{ id: `F${index}`, mimetype: 'image/png' }],
  }));
  assert.equal(imageRefs(many).length, 4);
});

test('prefers thumbnails and only accepts slack file hosts', () => {
  assert.equal(
    pickImageUrl({
      thumb_720: 'https://files.slack.com/thumb',
      url_private: 'https://files.slack.com/full',
    }),
    'https://files.slack.com/thumb',
  );
  assert.equal(
    pickImageUrl({
      thumb_720: 'https://evil.test/thumb',
      url_private: 'https://files.slack.com/full',
    }),
    'https://files.slack.com/full',
  );
  assert.equal(pickImageUrl({ url_private: 'http://files.slack.com/full' }), null);
  assert.equal(isSlackFileUrl('https://slack-files.com/file'), true);
  assert.equal(isSlackFileUrl('https://files.slack.com.evil.test/file'), false);
});

test('downloads images into MCP blocks', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, file: args.file });
      return {
        file: {
          mimetype: 'image/png',
          size: 3,
          thumb_720: 'https://files.slack.com/thumb',
          url_private: 'https://files.slack.com/full',
        },
      };
    },
    download: async (url, maxBytes) => {
      assert.equal(url, 'https://files.slack.com/thumb');
      assert.equal(maxBytes, 1024 * 1024);
      return Buffer.from('png');
    },
  };

  const { blocks, skipped } = await imageBlocks(
    [{ id: 'F1' }, { id: 'F1' }, { id: 'nope' }, { id: 'F2' }],
    { slack, maxBytes: 1024 * 1024 },
  );

  assert.deepEqual(
    calls.map((call) => call.file),
    ['F1', 'F2'],
  );
  assert.equal(skipped, 0);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].mimeType, 'image/png');
  assert.equal(Buffer.from(blocks[0].data, 'base64').toString(), 'png');
});

test('skips non-images, oversized files, and failed downloads', async () => {
  const slack = {
    call: async (_method, args) => {
      if (args.file === 'F1') return { file: { mimetype: 'text/plain' } };
      if (args.file === 'F2') return { file: { mimetype: 'image/png', size: 2048 } };
      if (args.file === 'F3') {
        return {
          file: { mimetype: 'image/png', size: 3, url_private: 'https://files.slack.com/x' },
        };
      }
      throw new Error('not found');
    },
    download: async () => null,
  };

  const { blocks, skipped } = await imageBlocks(
    [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }, { id: 'F4' }],
    {
      slack,
      maxBytes: 1024,
    },
  );

  assert.equal(blocks.length, 0);
  assert.equal(skipped, 4);
});

test('saves a private copy when a store is provided', async () => {
  const saved = [];
  const store = {
    save: (bytes, mimetype) => {
      saved.push({ bytes: bytes.length, mimetype });
      return `/tmp/image-${saved.length}.png`;
    },
  };
  const slack = {
    call: async () => ({
      file: { mimetype: 'image/png', size: 3, url_private: 'https://files.slack.com/x' },
    }),
    download: async () => Buffer.from('png'),
  };

  const { paths } = await imageBlocks([{ id: 'F1' }], { slack, store });
  assert.deepEqual(paths, ['/tmp/image-1.png']);
  assert.deepEqual(saved, [{ bytes: 3, mimetype: 'image/png' }]);
});
