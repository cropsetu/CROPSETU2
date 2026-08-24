/**
 * SymptomImage — the picture a farmer taps to describe what they are seeing.
 *
 * Replaces the emoji that stood in for these twelve symptoms. The emoji were not
 * merely plain: several were actively wrong. `yellow_leaves` was 🍂 (a brown autumn
 * maple leaf), `curling_leaves` was 🌀 (a cyclone) and `root_rot` was 💀 (a skull).
 * A farmer who cannot read the label was being asked to recognise their problem in
 * the wrong picture.
 *
 * Tier 3 of the fallback stack in docs/branding/IMAGE_PROCESS.md §4: if an image is
 * missing, an Ionicon renders instead. There is never a blank box.
 *
 * These are INPUT AFFORDANCES, not diagnostic references — see IMAGE_PROCESS.md
 * §10.5. Never render them beside a real AI diagnosis result.
 */
import React from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Static requires — Metro resolves @2x from the same path, so one entry per symptom.
const IMAGES = {
  yellow_leaves:  require('../../assets/symptoms/yellow_leaves.webp'),
  brown_spots:    require('../../assets/symptoms/brown_spots.webp'),
  white_powder:   require('../../assets/symptoms/white_powder.webp'),
  wilting:        require('../../assets/symptoms/wilting.webp'),
  insects:        require('../../assets/symptoms/insects.webp'),
  holes:          require('../../assets/symptoms/holes.webp'),
  stunted:        require('../../assets/symptoms/stunted.webp'),
  fruit_damage:   require('../../assets/symptoms/fruit_damage.webp'),
  stem_rot:       require('../../assets/symptoms/stem_rot.webp'),
  curling_leaves: require('../../assets/symptoms/curling_leaves.webp'),
  root_rot:       require('../../assets/symptoms/root_rot.webp'),
  pale_color:     require('../../assets/symptoms/pale_color.webp'),
};

/** Ionicon shown when a symptom has no image yet. Deliberately generic. */
const FALLBACK = 'leaf-outline';

export default function SymptomImage({ symptom, size = 34, tint }) {
  const src = IMAGES[symptom];
  if (!src) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={FALLBACK} size={size * 0.8} color={tint || '#57685a'} />
      </View>
    );
  }
  return (
    <Image
      source={src}
      style={{ width: size, height: size, borderRadius: 6 }}
      resizeMode="cover"
      accessible={false}      /* the adjacent text label carries the meaning */
    />
  );
}
