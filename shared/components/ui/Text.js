// ─────────────────────────────────────────────────────────────────────────────
// Text — the KTYPE roles as the path of least resistance, and a hard stop on the
// Android fontFamily+fontWeight footgun.
//
// ADOPTION CONTRACT
//   <Text>hello</Text> renders EXACTLY what react-native's <Text> renders — no
//   family, no size, no leading, no colour. A screen can swap its import and
//   move zero pixels. Everything below is opt-in.
//
// THE ONE DELIBERATE EXCEPTION, and it is a bug fix rather than a restyle.
// Naming a custom fontFamily AND a fontWeight makes Android hunt for a font file
// that was never registered, fail, and fall back to system Roboto — throwing the
// brand face away. MEASURED in frontend/src/screens: 57 style blocks across 8
// files do this (weights 900×18, 800×18, 700×15, 600×3). Those 57 are honoured
// as intent — the weight is resolved INTO the family (700 + sans → sansBold) and
// fontWeight is deleted before it reaches the platform. iOS is unaffected;
// Android gets the brand face back.
//
// WHAT IS DELIBERATELY LEFT ALONE, and this is the whole reason the guard is
// conditional: 632 style blocks carry fontWeight with NO fontFamily. Those are
// legitimate system-font styles — `fontWeight: '700'` on Roboto/SF is correct and
// renders bold. A component that strips fontWeight unconditionally would flatten
// all 632 to regular, silently, across 47 files. So the guard fires only when a
// family is actually in play.
//
// FILLING THE WEIGHT GRID WITHOUT NEW TOKENS
// KTYPE is a size × family product with only the diagonal populated: sansMed
// exists at exactly one size (12), sansSemi at exactly one (13), and the serif
// ladder flips family at every step. The pilot left 9 font sizes raw that matched
// an existing SIZE and failed only on FAMILY. `role` picks the size band and
// `weight` picks the face, so the grid fills at the call site:
//     <Text role="body"      weight="med">   is the proposed KTYPE.bodyMed
//     <Text role="caption"   weight="reg">   is the proposed KTYPE.captionReg
//     <Text role="displayMd" weight="bold">  is the proposed KTYPE.displayMdBold
// That is ~15 tokens not added, and both axes covered instead of the diagonal.
//
// LEADING DEFAULTS OFF. 1,219 of 1,375 fontSize blocks inherit RN's platform- and
// font-dependent default, so a role's lineHeight is the one property that
// reflows a screen. The pilot needed noLead() on 11 of 12 adoptions — on a screen
// already themed to this system. So `role` gives size + family + tracking only;
// `lead` opts in. `lead={21}` replaces the silently order-dependent
// `{ ...noLead(KTYPE.body), lineHeight: 21 }` idiom, which loses its override the
// moment someone "upgrades" the spread to a full role.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useMemo } from 'react';
import { Text as RNText, StyleSheet } from 'react-native';
import { KFONT, KFONT_ALT, KTYPE, noLead } from '@cropsetu/shared/constants/khetTheme';
import { resolveColor } from './palette';

// ── Family stacks ────────────────────────────────────────────────────────────
// `weight` moves ALONG a stack and never across one, so asking for bold on a
// serif heading keeps it serif.
const STACKS = {
  sans: {
    400: KFONT.sans,
    500: KFONT.sansMed,
    600: KFONT.sansSemi,
    700: KFONT.sansBold,
    800: KFONT.sansExtra,
    900: KFONT.sansExtra, // Plus Jakarta loads no 900 face; 900 already resolves
    //                       to ExtraBold today. Making that explicit stops
    //                       Android from guessing (and losing the family).
  },
  serif: {
    400: KFONT.display,
    500: KFONT.displaySemi, // Fraunces has no 500 — round UP; the intent is emphasis
    600: KFONT.displaySemi,
    700: KFONT.displayBold,
    800: KFONT.displayBold,
    900: KFONT.displayBold,
  },
  // The Inter bridge. 212 fontFamily declarations resolve to Inter, and those
  // same screens hold most of the app's fontWeight declarations — so they need
  // this guard MORE than the Jakarta screens do. Included so they can adopt
  // <Text> today. This does NOT settle the open Inter-vs-Jakarta product call.
  inter: {
    400: KFONT_ALT.interReg,
    500: KFONT_ALT.interMed,
    600: KFONT_ALT.interSemi,
    700: KFONT_ALT.interBold,
    800: KFONT_ALT.interExtra,
    900: KFONT_ALT.interExtra,
  },
  // Fraunces Italic exists at 400 only, on its own stack with no siblings, so a
  // weight request is ignored rather than silently un-italicising the text.
  serifItalic: { 400: KFONT.displayItalic },
};

// face → [stack, weight], so a style that already names a face can be moved
// along its own stack. First writer wins, so 800 does not steal 900's slot as
// the canonical reverse lookup for sansExtra.
const FACE_INDEX = (() => {
  const idx = {};
  Object.keys(STACKS).forEach((stack) => {
    Object.keys(STACKS[stack]).forEach((w) => {
      const face = STACKS[stack][w];
      if (face && !idx[face]) idx[face] = [stack, Number(w)];
    });
  });
  return idx;
})();

const WEIGHT_ALIAS = {
  reg: 400, regular: 400, normal: 400, book: 400,
  med: 500, medium: 500,
  semi: 600, semibold: 600, sb: 600,
  bold: 700, strong: 700,
  extra: 800, extrabold: 800, heavy: 800,
  black: 900,
};

const LADDER = [400, 500, 600, 700, 800, 900];

function normaliseWeight(w) {
  if (w == null) return null;
  if (typeof w === 'number') return w;
  const s = String(w).toLowerCase();
  if (WEIGHT_ALIAS[s] != null) return WEIGHT_ALIAS[s];
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Nearest available face on a stack, biased HEAVIER on a tie — a missing 500 on
// a stack that has 400 and 600 should read as emphasis, not as body.
function faceFor(stack, weight) {
  const table = STACKS[stack];
  if (!table) return null;
  if (table[weight]) return table[weight];
  let best = null;
  let bestScore = Infinity;
  LADDER.forEach((w) => {
    if (!table[w]) return;
    const score = Math.abs(w - weight) * 2 + (w < weight ? 1 : 0);
    if (score < bestScore) { bestScore = score; best = table[w]; }
  });
  return best;
}

// Inherited family stack, so a nested <Text weight="bold"> with no role picks the
// sibling of ITS PARENT's face rather than defaulting to sans.
const StackContext = createContext(null);

const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

/**
 * <Text
 *   role       any KTYPE key. Size + family + tracking. NO leading unless asked.
 *              Omit it and this is a plain RN Text.
 *   weight     'reg'|'med'|'semi'|'bold'|'extra'|'black' or 400..900. Moves along
 *              the resolved family's own stack. With NO role it emits fontFamily
 *              only, so a nested Text keeps its parent's size — the size-free
 *              emphasis role KTYPE cannot express.
 *   lead       false (default) = no lineHeight at all
 *              true            = the role's authored leading
 *              <number>        = that leading, explicitly and order-independently
 *   tone       a semantic ink name — 'muted'|'primary'|'danger'|'gold'|'onDark'…
 *              Always the AA-safe TEXT step, never the surface step.
 *   color      raw escape hatch: any colour string, or a KHET key.
 *   align      'left'|'center'|'right'
 *   serif      swap to the Fraunces stack at the same size.
 * />
 * Every other prop (numberOfLines, onPress, accessibilityRole, selectable,
 * testID, allowFontScaling, …) passes straight through to RN's Text.
 */
export default function Text({
  role,
  weight,
  serif = false,
  lead = false,
  tone,
  color,
  align,
  style,
  children,
  ...rest
}) {
  const inherited = useContext(StackContext);

  const { out, stack } = useMemo(() => {
    // 1. The role, with or without its leading.
    let base = {};
    if (role) {
      const step = KTYPE[role];
      if (step) {
        base = lead === true ? { ...step } : noLead(step);
      } else if (DEV) {
        console.warn(
          `[khet/Text] unknown role "${role}". Known roles: ${Object.keys(KTYPE).join(', ')}`
        );
      }
    }

    // 2. Caller style wins over the role — the half-migration escape hatch.
    const flat = StyleSheet.flatten(style) || {};
    const merged = { ...base, ...flat };

    // 3. Which stack are we on? Explicit face > role's face > inherited.
    let stackName = null;
    let currentWeight = null;
    if (merged.fontFamily && FACE_INDEX[merged.fontFamily]) {
      [stackName, currentWeight] = FACE_INDEX[merged.fontFamily];
    } else if (!merged.fontFamily && inherited) {
      stackName = inherited.stack;
      currentWeight = inherited.weight;
    }
    if (serif && stackName !== 'serifItalic') stackName = 'serif';

    // 4. The weight request: the explicit prop first, then a fontWeight the
    //    caller left in `style` — but ONLY when a family is actually in play.
    //
    //    THIS CONDITION IS THE WHOLE ZERO-IMPOSITION CONTRACT. 632 measured
    //    style blocks carry fontWeight with no fontFamily; they are legitimate
    //    system-font styles and resolving them into a brand face would restyle
    //    47 files on adoption. Only the 57 blocks that pair the two are rewritten.
    const explicit = normaliseWeight(weight);
    const hasFamily = Boolean(merged.fontFamily || stackName);
    const asked = explicit != null
      ? explicit
      : (hasFamily ? normaliseWeight(merged.fontWeight) : null);

    if (asked != null) {
      const target = stackName || 'sans';
      const face = faceFor(target, asked);
      if (face) {
        merged.fontFamily = face;
        stackName = target;
        currentWeight = asked;
      }
    } else if (serif && stackName === 'serif' && !merged.fontFamily) {
      merged.fontFamily = faceFor('serif', currentWeight || 400);
    }

    // 5. THE GUARD. A custom face and a fontWeight must never ship together.
    if (merged.fontFamily && merged.fontWeight != null) {
      if (DEV && explicit == null) {
        const w = normaliseWeight(merged.fontWeight);
        const name = Object.keys(WEIGHT_ALIAS).find((k) => WEIGHT_ALIAS[k] === w) || 'bold';
        console.warn(
          `[khet/Text] dropped fontWeight:${merged.fontWeight} sitting next to ` +
          `fontFamily:${merged.fontFamily}. On Android that pair falls back to ` +
          `Roboto and throws the brand face away. The weight was resolved into ` +
          `the family instead — say it directly with weight="${name}".`
        );
      }
      delete merged.fontWeight;
    }

    // 6. Leading.
    if (typeof lead === 'number') merged.lineHeight = lead;
    else if (lead === false && flat.lineHeight == null) delete merged.lineHeight;

    // 7. Ink. `tone` is the curated, contrast-checked path; `color` is raw.
    const c = resolveColor(tone != null ? tone : color, null);
    if (c != null) merged.color = c;
    if (align) merged.textAlign = align;

    const nextStack = merged.fontFamily && FACE_INDEX[merged.fontFamily]
      ? { stack: FACE_INDEX[merged.fontFamily][0], weight: currentWeight ?? FACE_INDEX[merged.fontFamily][1] }
      : (stackName ? { stack: stackName, weight: currentWeight ?? 400 } : inherited);

    return { out: merged, stack: nextStack };
  }, [role, weight, serif, lead, tone, color, align, style, inherited]);

  // Emit NO style object at all when nothing was asked for, so a bare <Text> is
  // indistinguishable from RN's.
  const node = (
    <RNText {...rest} style={Object.keys(out).length ? out : undefined}>
      {children}
    </RNText>
  );

  // Only re-provide when the stack actually changed, so nested Texts do not each
  // mount a provider for the same value.
  if (!stack || stack === inherited) return node;
  return <StackContext.Provider value={stack}>{node}</StackContext.Provider>;
}

/**
 * The size-free bold lead-in:
 *     <Text role="bodySm">
 *       <Text.Strong>Symptom: </Text.Strong>{value}
 *     </Text>
 * Renders 6× on the pilot screen alone, at two different host sizes (13.5 and
 * 12.5). Every KTYPE role forces a fontSize, so no role can express "same size as
 * my parent, heavier face" — the pilot's conclusion was that the token system has
 * no answer for it. This emits fontFamily only, so RN's native size inheritance
 * still applies, and it picks the face from the PARENT's stack via context.
 */
Text.Strong = function Strong(props) {
  return <Text weight="bold" {...props} />;
};

Text.Med = function Med(props) {
  return <Text weight="med" {...props} />;
};
