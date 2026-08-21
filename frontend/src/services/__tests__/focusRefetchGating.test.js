/**
 * Screens must not fetch twice when they open (claude.md §42).
 *
 * The pattern that caused it:
 *
 *   useEffect(() => { load()... }, [load]);              // mount
 *   useFocusEffect(useCallback(() => { load(); }, []));  // AND first focus
 *
 * Both fire on first open, so the screen makes two identical requests, and the
 * bare focus effect then re-fetches on every re-focus with no staleness check —
 * tab away and straight back and it goes again. On a village connection that is
 * the farmer waiting twice for the same list.
 *
 * useFocusRefresh already solves this, but it DEFAULTS runOnFirstFocus to true.
 * Following its docs without passing the flag re-creates the exact duplicate it
 * exists to remove, so the flag is what these assert.
 *
 * Source-level rather than behavioural: exercising the hook needs a
 * NavigationContainer, and this jest config is deliberately the light one
 * (node environment, no jest-expo preset). What would actually regress here is
 * someone dropping the option, and that is visible in the source.
 */
import fs from 'fs';
import path from 'path';

const SCREENS = [
  'src/screens/AI/ScanHistoryScreen.js',
  'src/screens/AI/VoiceHistoryScreen.js',
];

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

describe.each(SCREENS)('%s', (rel) => {
  const src = read(rel);

  test('does not call useFocusEffect directly any more', () => {
    // A bare useFocusEffect has no staleness gate and no first-focus opt-out.
    const calls = src.match(/useFocusEffect\s*\(/g) || [];
    expect(calls).toHaveLength(0);
  });

  test('gates the first focus, so the mount effect stays the only loader', () => {
    expect(src).toMatch(/useFocusRefresh\(/);
    expect(src).toMatch(/runOnFirstFocus:\s*false/);
  });

  test('still loads once on mount', () => {
    // Removing the mount effect without moving the load into the hook would
    // leave the screen blank until the first refocus.
    expect(src).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*load\(\)/);
  });

  test('passes a staleness window, so re-focus is not an automatic refetch', () => {
    expect(src).toMatch(/staleMs:\s*[\d_]+/);
  });
});

describe('the helper itself', () => {
  const helper = read('src/hooks/useFocusRefresh.js');

  test('still defaults runOnFirstFocus to true', () => {
    // Not an endorsement — a warning. Every caller that already has a mount
    // effect has to opt out explicitly, and this test exists so that the day
    // someone flips the default, the screens above are re-checked rather than
    // silently changing behaviour.
    expect(helper).toMatch(/runOnFirstFocus\s*=\s*true/);
  });

  test('starts the freshness clock even when it skips the first focus', () => {
    // Otherwise the SECOND focus would look like the first and fetch anyway,
    // which would move the duplicate rather than remove it.
    const body = helper.slice(helper.indexOf('const firstFocus'));
    expect(body.indexOf('lastRunRef.current = now'))
      .toBeLessThan(body.indexOf('if (firstFocus && !runOnFirstFocus)'));
  });
});
