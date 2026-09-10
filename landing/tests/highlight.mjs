import assert from 'node:assert/strict';
import { examples, highlight } from '../src/lib/demo.ts';

const marked = (text) => highlight(text).filter(part => part.kind).map(part => `${part.kind}:${part.text}`);

// Parts must reassemble the input exactly, or the highlight layer drifts out of
// alignment with the input it sits behind.
for (const { text } of [...examples, { text: 'Every Monday from 8pm to 10pm' }, { text: '' }, { text: 'gibberish' }]) {
  assert.equal(highlight(text).map(part => part.text).join(''), text, text);
}

assert.deepEqual(marked('Every Monday from 8pm to 10pm'), [
  'repeat:Every', 'date:Monday', 'time:from 8pm to 10pm',
]);
assert.deepEqual(marked('every other Friday at noon'), [
  'repeat:every other', 'date:Friday', 'time:noon',
]);
assert.deepEqual(marked('in half an hour for 45 minutes'), [
  'duration:in half an hour', 'duration:for 45 minutes',
]);
assert.deepEqual(marked('gibberish'), []);
console.log('highlight: parts reassemble and carry the expected meanings');
