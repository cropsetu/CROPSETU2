// ─────────────────────────────────────────────────────────────────────────────
// <OptionIcon/> — renders an option's `icon` descriptor
// ─────────────────────────────────────────────────────────────────────────────
// Bridges the pure-data option configs (options.js) to the app's existing,
// purpose-built farm artwork so the pickers look native to CropSetu. Anything
// without bespoke art falls back to a themed lucide glyph.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { CircleQuestionMark, Waves, Sprout } from 'lucide-react-native';
import CropIcon from '../../../../components/CropIcons';
import SoilIcon from '../../../../components/SoilIcons';
import IrrigationIcon from '../../../../components/IrrigationIcons';

// Only the lucide glyphs actually referenced by options.js fallbacks.
const LUCIDE = { CircleQuestionMark, Waves, Sprout };

/**
 * @param {object} props
 * @param {{kind:string, key?:string, name?:string}} props.icon
 * @param {number} props.size
 * @param {string} [props.color]   Used by lucide fallbacks only.
 */
export default function OptionIcon({ icon, size = 36, color = '#15663F' }) {
  if (!icon) return null;
  switch (icon.kind) {
    case 'crop':
      return <CropIcon crop={icon.key} size={size} />;
    case 'soil':
      return <SoilIcon type={icon.key} size={size} />;
    case 'irrig':
      return <IrrigationIcon type={icon.key} size={size} />;
    case 'lucide': {
      const Glyph = LUCIDE[icon.name] || Sprout;
      return <Glyph size={Math.round(size * 0.7)} color={color} strokeWidth={2} />;
    }
    default:
      return null;
  }
}
