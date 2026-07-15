import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithStreamRequestContext,
  getStreamRequestContext
} from '../../src/infrastructure/ai-workflow/stream-request-context.js';
import { createUserVisibleTurnState } from '../../src/utils/chat-user-visible-ack.js';

describe('stream request context', () => {
  it('isolates turnState between concurrent async chains', async () => {
    const results = await Promise.all([
      runWithStreamRequestContext({ e: { id: 'a' }, turnState: createUserVisibleTurnState() }, async () => {
        const turn = getStreamRequestContext().turnState;
        turn.queuedReplyContent = 'reply-a';
        await new Promise((r) => setTimeout(r, 20));
        return turn.queuedReplyContent;
      }),
      runWithStreamRequestContext({ e: { id: 'b' }, turnState: createUserVisibleTurnState() }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        const turn = getStreamRequestContext().turnState;
        return turn.queuedReplyContent || 'empty';
      })
    ]);
    assert.equal(results[0], 'reply-a');
    assert.equal(results[1], 'empty');
  });
});
