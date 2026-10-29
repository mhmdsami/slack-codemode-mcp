import assert from 'node:assert/strict';
import test from 'node:test';
import { condensedTranscript, renderMessageText, unescapeSlack } from '../src/actions/text.mjs';

test('unescapes Slack entities in one pass', () => {
  assert.equal(
    unescapeSlack('a &lt; b &gt; c &amp; d &#39;e&#39; &quot;f&quot;'),
    `a < b > c & d 'e' "f"`,
  );
  assert.equal(unescapeSlack('&amp;lt;'), '&lt;');
});

test('resolves mentions, broadcasts, and links', () => {
  const names = new Map([['U1', 'Jane']]);
  assert.equal(renderMessageText('hi <@U1> and <@U2>', names), 'hi @Jane and @U2');
  assert.equal(renderMessageText('<!channel> heads up', names), '@channel heads up');
  assert.equal(
    renderMessageText('<https://x.test|docs> <https://y.test>', names),
    'docs (https://x.test) https://y.test',
  );
  assert.equal(
    renderMessageText('<mailto:jane@example.com|email>', names),
    'email (mailto:jane@example.com)',
  );
});

test('builds a condensed transcript with time, names, and extras', () => {
  const names = new Map([['U1', 'Jane']]);
  const text = condensedTranscript(
    [
      {
        ts: '1699999999.000000',
        user: 'U1',
        text: 'hello\n<@U2>',
        reply_count: 2,
      },
      {
        ts: '1700000000.000000',
        user: 'U2',
        text: '',
        files: [{ id: 'F1', name: 'log.txt' }],
        reactions: [{ name: 'eyes', count: 2 }],
        edited: true,
      },
    ],
    names,
  );

  assert.equal(
    text,
    [
      '11-14 22:13 Jane: hello @U2 [2 replies]',
      '11-14 22:13 @U2: (no text) [files: log.txt; reactions: eyes x2; edited]',
    ].join('\n'),
  );
});
