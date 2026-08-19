/**
 * Placeholder cards shown while the first page of animals loads.
 *
 * A spinner on a blank screen gives no sense of what is coming or how long it
 * will take; a skeleton in the shape of the real grid makes the wait read as
 * "loading" rather than "empty", and the screen does not jump when the data
 * lands because the layout is already the right size.
 *
 * The shimmer, the palette and the screen-reader wiring now come from the app's
 * one skeleton kit (components/ui/Skeleton), which runs the pulse on the UI
 * thread so it keeps moving while JS is busy parsing the response. All this
 * file still owns is the animal grid's own proportions — the 0.85 photo ratio
 * and the 14px gutter the listing FlatList lays its cards out on.
 */
import { memo } from 'react';
import { SkeletonGrid } from './ui/Skeleton';

/** @param {{rows?: number, label?: string}} props — how many 2-card rows to draw. */
function AnimalCardSkeleton({ rows = 4, label = 'Loading animals' }) {
  return (
    <SkeletonGrid
      rows={rows}
      columns={2}
      gutter={14}
      photoRatio={0.85}
      label={label}
    />
  );
}

export default memo(AnimalCardSkeleton);
